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
 * Geração de imagem por IA = PREVIEW (#132/#222, ADR-0017/0022) — `/api/recipes/[id]/image/generate`.
 * Owner-only; FakeImageGenerator/FakeImageStore (NUNCA tocam Gemini/Blob). #222: a geração ACRESCENTA
 * uma `recipe_image` DESELECIONADA à galeria da linhagem e devolve `{ image }` — NÃO troca a face
 * (`image_id` intacto), NÃO reapa a anterior (a galeria mantém todas). O ledger conta os EVENTOS
 * (teto inalterado, ADR-0017). Anon/não-dono barrados; degradação → 503.
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

describe('/api/recipes/[id]/image/generate — geração-como-preview (#132/#222)', () => {
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

  it('#222 dono gera = PREVIEW: 200 com { image } (deselecionada); image_id NÃO muda; created_by/ai_generated/lineage', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gera@gen.test' })
    const id = await seedOwned(userId, 'Feijoada')
    const [r0] = await getDb().select({ lineageId: recipe.lineageId, imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, id))

    const res = await POST(genReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      image?: { id: string; url: string; aiGenerated: boolean; selected: boolean }
      basePrompt?: string
    }
    expect(body.image).toBeDefined()
    expect(body.image!.aiGenerated).toBe(true)
    expect(body.image!.selected).toBe(false) // preview — NÃO é a face
    // #223: a resposta traz o prompt-base (pro modal mostrar read-only) — o base montado da receita.
    expect(body.basePrompt).toBeDefined()
    expect(body.basePrompt).toContain('Feijoada')
    expect(gen.calls).toBe(1)
    expect(gen.lastPrompt).toContain('Feijoada') // prompt montado da receita

    // A face NÃO mudou (preview não seleciona) — image_id segue o que era (null aqui).
    expect((await imageState(id)).imageId).toBe(r0.imageId)
    // A imagem nasceu na MESMA linhagem da Receita, ai_generated, created_by = dono.
    const [img] = await getDb()
      .select({ provenance: recipeImage.provenance, createdBy: recipeImage.createdBy, lineageId: recipeImage.lineageId })
      .from(recipeImage)
      .where(eq(recipeImage.id, body.image!.id))
    expect(img).toMatchObject({ provenance: 'ai_generated', createdBy: userId, lineageId: r0.lineageId })
    // O ledger contou o evento (custo gasto).
    expect(await countGenEvents(userId)).toBe(1)
  })

  it('prompt editado (refino) ANCORA no base da receita + vira nota de estilo no template estruturado (#214/#223)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'refino@gen.test' })
    const id = await seedOwned(userId)
    const res = await POST(genReq(id, headers, 'um prato futurista neon'), ctx(id))
    // #223: o servidor re-deriva o base (título da receita) E o refino, no template estruturado.
    expect(gen.lastPrompt).toContain('Bolo de fubá') // base re-derivado no servidor (#214)
    expect(gen.lastPrompt).toContain('sujeito fotográfico principal') // template estruturado (#223)
    expect(gen.lastPrompt).toContain('refinamento de estilo: um prato futurista neon')
    // #223: a resposta inclui o basePrompt (pro modal mostrar read-only); é só o base, SEM o refino.
    const body = (await res.json()) as { basePrompt?: string }
    expect(body.basePrompt).toBeDefined()
    expect(body.basePrompt).toContain('Bolo de fubá')
    expect(body.basePrompt).not.toContain('um prato futurista neon') // o refino NÃO faz parte do base
  })

  it('#222 gerar de novo APPENDA (NÃO reapa): ambas as imagens sobrevivem; image_id intacto; ledger=2', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen@gen.test' })
    const id = await seedOwned(userId)

    const first = (await (await POST(genReq(id, headers), ctx(id))).json()) as { image: { id: string; url: string } }
    const second = (await (await POST(genReq(id, headers), ctx(id))).json()) as { image: { id: string; url: string } }

    expect(second.image.url).not.toBe(first.image.url)
    // #222: o reap-on-swap saiu de cena — AMBAS ficam na galeria (blobs preservados).
    expect(store.blobs.has(first.image.url)).toBe(true)
    expect(store.blobs.has(second.image.url)).toBe(true)
    expect(await countAiGen()).toBe(2) // as duas recipe_image sobrevivem (sem reap)
    // A face nunca mudou (preview não seleciona).
    expect((await imageState(id)).imageId).toBeNull()
    // O ledger contou as DUAS gerações (custo gasto — ADR-0017).
    expect(await countGenEvents(userId)).toBe(2)
  })

  it('#222 cap conta o ledger mesmo sem reap: 3 gerações consomem o teto; a 4ª estoura (429)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'burla@gen.test' }) // usuario, cap 3
    const id = await seedOwned(userId)

    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect(await countAiGen()).toBe(3) // 3 na galeria (sem reap)
    expect(await countGenEvents(userId)).toBe(3)

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
    expect((await POST(genReq(id, headers), ctx(id))).status).toBe(200)
    expect(gen.lastModel).toBe(DEFAULT_IMAGE_MODEL)
  })
})
