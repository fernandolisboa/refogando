import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST } from '@/app/api/recipes/[id]/image/generate/route'
import { getDb, setImageStore, setImageGenerator } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator, ThrowingImageGenerator } from '@/server/images/image-generator'
import { recipe, recipeImage, imageGeneration, appConfig } from '@/db/schema'
import { DEFAULT_IMAGE_MODEL, type ImageGenCapByRole } from '@/domain/image-gen-config'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Geração de imagem por IA (#132, ADR-0017) — `/api/recipes/[id]/image/generate`. Owner-only;
 * FakeImageGenerator/FakeImageStore (NUNCA tocam Gemini/Blob). Cobre: gera → recipe_image
 * (ai_generated) + image_id + created_by; prompt montado da receita ou editado; teto por papel na
 * janela 24h (429 + countdown, generator NÃO chamado); regenerar substitui (ref-count); degradação
 * → 503; anon/não-dono barrados (Throwing prova que o seam não foi tocado).
 */

let store: FakeImageStore
let gen: FakeImageGenerator
beforeEach(() => {
  store = new FakeImageStore()
  gen = new FakeImageGenerator()
  setImageStore(store)
  setImageGenerator(gen)
})

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
function genReq(id: string, headers?: Headers, prompt?: string): Request {
  return new Request(`http://localhost/api/recipes/${id}/image/generate`, {
    method: 'POST',
    headers: { ...(headers ? Object.fromEntries(headers) : {}), 'content-type': 'application/json' },
    body: prompt !== undefined ? JSON.stringify({ prompt }) : undefined,
  })
}
async function imageState(recipeId: string): Promise<{ imageId: string | null }> {
  const [r] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, recipeId))
  return { imageId: r?.imageId ?? null }
}
async function countAiGen(): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(recipeImage).where(eq(recipeImage.provenance, 'ai_generated'))
  return r?.n ?? 0
}
/** Receita ai própria com título + 1 ingrediente (pro prompt). */
async function seedOwned(ownerId: string, titulo = 'Bolo de fubá'): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'automatica_nao_revisada' })
  await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'fubá', quantidade: null })
  return id
}
/** Insere N EVENTOS de geração no ledger do usuário (a fonte do teto — não recipe_image). */
async function seedAiGenForUser(userId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await getDb().insert(imageGeneration).values({ userId })
  }
}
/** Conta os eventos no ledger (prova que o teto conta EVENTOS, não imagens sobreviventes). */
async function countGenEvents(userId: string): Promise<number> {
  const [r] = await getDb().select({ n: sql<number>`count(*)::int` }).from(imageGeneration).where(eq(imageGeneration.userId, userId))
  return r?.n ?? 0
}
/** #134: grava a config de geração no singleton app_config (campos omitidos caem nos DEFAULTs). */
async function setImageGenConfig(cfg: { enabled?: boolean; model?: string; capByRole?: ImageGenCapByRole }): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({
      id: true,
      ...(cfg.enabled !== undefined ? { imageGenEnabled: cfg.enabled } : {}),
      ...(cfg.model !== undefined ? { imageGenModel: cfg.model } : {}),
      ...(cfg.capByRole !== undefined ? { imageGenCapByRole: cfg.capByRole } : {}),
    })
    .onConflictDoUpdate({
      target: appConfig.id,
      set: {
        ...(cfg.enabled !== undefined ? { imageGenEnabled: cfg.enabled } : {}),
        ...(cfg.model !== undefined ? { imageGenModel: cfg.model } : {}),
        ...(cfg.capByRole !== undefined ? { imageGenCapByRole: cfg.capByRole } : {}),
      },
    })
}

describe('/api/recipes/[id]/image/generate — geração por IA (#132)', () => {
  it('anon → 401; o gerador NÃO é tocado', async () => {
    const owner = await seedUser({ email: 'o@gen.test' })
    const id = await seedOwned(owner)
    setImageGenerator(new ThrowingImageGenerator())
    const res = await POST(genReq(id), ctx(id))
    expect(res.status).toBe(401)
  })

  it('não-dono → 404; o gerador (Throwing) NÃO foi chamado', async () => {
    const owner = await seedUser({ email: 'owner@gen.test' })
    const id = await seedOwned(owner)
    const throwing = new ThrowingImageGenerator()
    setImageGenerator(throwing)
    const { headers } = await seedSessionHeaders({ email: 'intruso@gen.test' })

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(404)
    expect(throwing.calls).toBe(0) // gate de dono ANTES do seam
  })

  it('dono gera (um-clique) → 200; recipe_image ai_generated + image_id + created_by; prompt da receita', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gera@gen.test' })
    const id = await seedOwned(userId, 'Feijoada')

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    const view = (await res.json()) as { imageUrl?: string; imageAiGenerated?: boolean }
    expect(view.imageAiGenerated).toBe(true) // selo
    expect(gen.calls).toBe(1)
    expect(gen.lastPrompt).toContain('Feijoada') // prompt montado da receita

    const imageId = (await imageState(id)).imageId
    expect(imageId).not.toBeNull()
    const [img] = await getDb().select({ provenance: recipeImage.provenance, createdBy: recipeImage.createdBy }).from(recipeImage).where(eq(recipeImage.id, imageId!))
    expect(img).toMatchObject({ provenance: 'ai_generated', createdBy: userId })
  })

  it('prompt editado (refino) é repassado ao gerador', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'refino@gen.test' })
    const id = await seedOwned(userId)
    await POST(genReq(id, headers, 'um prato futurista neon'), ctx(id))
    expect(gen.lastPrompt).toBe('um prato futurista neon')
  })

  it('regenerar substitui: ref-count apaga a ai_generated anterior, mantém a nova', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen@gen.test' })
    const id = await seedOwned(userId)

    const first = (await (await POST(genReq(id, headers), ctx(id))).json()) as { imageUrl: string }
    const second = (await (await POST(genReq(id, headers), ctx(id))).json()) as { imageUrl: string }

    expect(second.imageUrl).not.toBe(first.imageUrl)
    expect(store.blobs.has(first.imageUrl)).toBe(false) // anterior coletado (0 refs) — AC
    expect(store.blobs.has(second.imageUrl)).toBe(true)
    expect(await countAiGen()).toBe(1) // só a atual sobrevive (recipe_image reapado)
    // ...MAS o ledger contou as DUAS gerações (custo gasto não devolve slot — ADR-0017).
    expect(await countGenEvents(userId)).toBe(2)
  })

  it('regenerar a MESMA receita CONSOME o teto (ledger conta eventos, não imagens sobreviventes)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'burla@gen.test' }) // usuario, cap 3
    const id = await seedOwned(userId)

    // 3 gerações na MESMA receita (recipe_image fica em 1 por reap; o ledger acumula 3).
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect(await countAiGen()).toBe(1)
    expect(await countGenEvents(userId)).toBe(3)

    // 4ª estoura o teto — antes do fix, isto era ilimitado (reap "devolvia" o slot).
    const fourth = await POST(genReq(id, headers), ctx(id))
    expect(fourth.status).toBe(429)
    await expect(fourth.json()).resolves.toMatchObject({ error: 'limite_geracao' })
  })

  it('teto estourado (usuario: 3 na janela) → 429 com retryAfterMs; gerador NÃO chamado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'teto@gen.test' }) // role usuario
    const id = await seedOwned(userId)
    await seedAiGenForUser(userId, 3) // já no teto

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
    expect(gen.calls).toBe(0) // o teto barra ANTES de gerar
  })

  it('admin não tem teto (∞): gera mesmo com muitas gerações recentes', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'admin@gen.test', role: 'admin' })
    const id = await seedOwned(userId)
    await seedAiGenForUser(userId, 10)

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    expect(gen.calls).toBe(1)
  })

  it('gerador indisponível (Throwing) → 503; nenhuma recipe_image, image_id intacto', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'down@gen.test' })
    const id = await seedOwned(userId)
    setImageGenerator(new ThrowingImageGenerator())

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: 'geracao_indisponivel' })
    expect((await imageState(id)).imageId).toBeNull()
    expect(await countAiGen()).toBe(0)
  })

  // ── #134: a geração respeita a config do admin (enabled/model/teto) ───────────────
  it('#134 geração DESLIGADA na config → 403 geracao_desabilitada; o gerador NÃO é tocado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'off@gen.test' })
    const id = await seedOwned(userId)
    await setImageGenConfig({ enabled: false })
    const throwing = new ThrowingImageGenerator()
    setImageGenerator(throwing)

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'geracao_desabilitada' })
    expect(throwing.calls).toBe(0) // bloqueio ANTES do seam
    expect((await imageState(id)).imageId).toBeNull()
    expect(await countGenEvents(userId)).toBe(0) // nada consumido
  })

  it('#134 teto vem da CONFIG: usuario cap=1 ⇒ 2ª geração estoura (429), não o default 3', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'capcfg@gen.test' }) // role usuario
    const id = await seedOwned(userId)
    await setImageGenConfig({ capByRole: { usuario: 1, curador: 5, admin: null } })

    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200) // 1ª cabe
    const second = await POST(genReq(id, headers), ctx(id))
    expect(second.status).toBe(429) // teto da CONFIG (1), não o fixo (3)
    await expect(second.json()).resolves.toMatchObject({ error: 'limite_geracao' })
  })

  it('#134 teto da config pode AFROUXAR: usuario cap=5 ⇒ 4ª geração ainda cabe (default seria 3)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'caphi@gen.test' }) // role usuario
    const id = await seedOwned(userId)
    await setImageGenConfig({ capByRole: { usuario: 5, curador: 5, admin: null } })
    await seedAiGenForUser(userId, 3) // já passaria o default fixo (3)

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(200) // cap 5 da config ⇒ a 4ª cabe
  })

  it('#134 o MODELO da config é repassado ao gerador (antes era undefined)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'modelo@gen.test' })
    const id = await seedOwned(userId)
    // Sem linha de config ⇒ defaults; o modelo default deve chegar ao seam (não undefined).
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect(gen.lastModel).toBe(DEFAULT_IMAGE_MODEL)
  })
})
