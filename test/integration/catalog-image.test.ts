import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST as catGen } from '@/app/api/curate/recipes/[id]/image/generate/route'
import { POST as catUpload, DELETE as catDeselect } from '@/app/api/curate/recipes/[id]/image/route'
import { POST as catSelect } from '@/app/api/curate/recipes/[id]/images/[imageId]/select/route'
import { DELETE as catImgDelete } from '@/app/api/curate/recipes/[id]/images/[imageId]/route'
import { GET as catGet, PATCH as catEdit } from '@/app/api/curate/recipes/[id]/route'
import { POST as approveRoute } from '@/app/api/curate/recipes/[id]/approve/route'
import { getDb, setImageStore, setImageGenerator } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator, ThrowingImageGenerator } from '@/server/images/image-generator'
import { recipe, recipeImage, recipeIngredient, imageGeneration } from '@/db/schema'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedRecipeImage } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Imagem + edição de CATÁLOGO pelo Curador (#238, ADR-0026 emenda dec.9-13). Antes impossível: todo
 * caminho de imagem gateia ownerId===userId ⇒ catálogo (owner-null) sempre 404. Aqui exercitamos as
 * rotas de CURADOR (gate origin='catalog'), o NÃO-VAZAMENTO (curador numa receita de USUÁRIO → 404 em
 * TODAS as superfícies — o risco #1), a edição de ingredientes/tempos, e a auto-gen na aprovação.
 * Fakes (NUNCA tocam Gemini/Blob).
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
const ctx2 = (id: string, imageId: string) => ({ params: Promise.resolve({ id, imageId }) })
const h = (headers?: Headers) => (headers ? Object.fromEntries(headers) : {})

function jsonReq(url: string, headers?: Headers, method = 'POST', body?: unknown): Request {
  const noBody = method === 'GET' || method === 'HEAD'
  return new Request(url, {
    method,
    headers: { ...h(headers), 'content-type': 'application/json' },
    body: noBody ? undefined : body !== undefined ? JSON.stringify(body) : '{}',
  })
}
function uploadReq(id: string, headers?: Headers): Request {
  const form = new FormData()
  form.append('file', new Blob([Buffer.from([1, 2, 3, 4])], { type: 'image/png' }), 'x.png')
  return new Request(`http://localhost/api/curate/recipes/${id}/image`, {
    method: 'POST',
    headers: { ...h(headers) },
    body: form,
  })
}

async function curator() {
  return seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
}
async function plainUser() {
  return seedSessionHeaders({ email: `usr-${crypto.randomUUID()}@ex.com` })
}

/** Rascunho de catálogo pending (owner-null) com título + 1 ingrediente. */
async function seedCatalogDraft(titulo = 'Moqueca'): Promise<string> {
  const id = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    curationStatus: 'pending',
    cozinha: 'brasileira',
    categoria: 'prato_principal',
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'automatica_nao_revisada' })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'peixe', quantidade: '0.500', unidade: 'kg' })
  return id
}

async function imageIdOf(id: string): Promise<string | null> {
  const [r] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, id))
  return r?.imageId ?? null
}
async function countImages(id: string): Promise<number> {
  const [lin] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, id))
  const [c] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(recipeImage)
    .where(eq(recipeImage.lineageId, lin!.lineageId))
  return c?.n ?? 0
}

describe('Imagem/edição de catálogo — autorização (não-vazamento, risco #1)', () => {
  it('curador NÃO opera imagem numa receita de USUÁRIO (owner não-null) — 404 em TODAS as rotas', async () => {
    const { userId } = await plainUser()
    const { headers: cur } = await curator()
    // receita de USUÁRIO (owner não-null, origin não-catalog).
    const userRecipe = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: userId, visibility: 'public' })
    await seedTranslation({ recipeId: userRecipe, locale: 'pt-BR', titulo: 'Do usuário', provenance: 'escrita_por_pessoa' })
    const fakeImg = '00000000-0000-0000-0000-0000000000aa'

    expect((await catGen(jsonReq(`http://localhost/x`, cur), ctx(userRecipe))).status).toBe(404)
    expect((await catUpload(uploadReq(userRecipe, cur), ctx(userRecipe))).status).toBe(404)
    expect((await catDeselect(jsonReq(`http://localhost/x`, cur, 'DELETE'), ctx(userRecipe))).status).toBe(404)
    expect((await catSelect(jsonReq(`http://localhost/x`, cur), ctx2(userRecipe, fakeImg))).status).toBe(404)
    expect((await catImgDelete(jsonReq(`http://localhost/x`, cur, 'DELETE'), ctx2(userRecipe, fakeImg))).status).toBe(404)
    expect((await catGet(jsonReq(`http://localhost/x`, cur, 'GET'), ctx(userRecipe))).status).toBe(404)
    expect((await catEdit(jsonReq(`http://localhost/x`, cur, 'PATCH', { titulo: 'x' }), ctx(userRecipe))).status).toBe(404)
  })

  it('não-curador (usuário comum) é barrado nas rotas de imagem do catálogo — 403', async () => {
    const { headers: u } = await plainUser()
    const draft = await seedCatalogDraft()
    expect((await catGen(jsonReq(`http://localhost/x`, u), ctx(draft))).status).toBe(403)
    expect((await catUpload(uploadReq(draft, u), ctx(draft))).status).toBe(403)
    expect((await catGet(jsonReq(`http://localhost/x`, u, 'GET'), ctx(draft))).status).toBe(403)
  })

  it('anônimo (sem sessão) — 401 na geração de imagem do catálogo', async () => {
    const draft = await seedCatalogDraft()
    expect((await catGen(jsonReq(`http://localhost/x`), ctx(draft))).status).toBe(401)
  })
})

describe('Imagem de catálogo — comportamento', () => {
  it('gerar: cria 1 imagem ai_generated, AUTO-SELECIONA a face, devolve gallery', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()
    expect(await imageIdOf(draft)).toBeNull()

    const res = await catGen(jsonReq(`http://localhost/x`, cur), ctx(draft))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { gallery: { id: string; selected: boolean; aiGenerated: boolean }[] }
    expect(body.gallery.length).toBe(1)
    expect(body.gallery[0].selected).toBe(true)
    expect(body.gallery[0].aiGenerated).toBe(true)
    // a face foi setada no banco (auto-select).
    expect(await imageIdOf(draft)).toBe(body.gallery[0].id)
  })

  it('subir foto: cria user_photo e auto-seleciona; deselecionar zera a face', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()

    const up = await catUpload(uploadReq(draft, cur), ctx(draft))
    expect(up.status).toBe(200)
    expect(await imageIdOf(draft)).not.toBeNull()

    const del = await catDeselect(jsonReq(`http://localhost/x`, cur, 'DELETE'), ctx(draft))
    expect(del.status).toBe(200)
    expect(await imageIdOf(draft)).toBeNull()
  })

  it('gerar escreve 1 linha de ledger com userId=curador, cost_usd e model NÃO-nulos (dec.11)', async () => {
    const { headers: cur, userId: curId } = await curator()
    const draft = await seedCatalogDraft()
    await catGen(jsonReq(`http://localhost/x`, cur), ctx(draft))
    const rows = await getDb().select().from(imageGeneration).where(eq(imageGeneration.userId, curId))
    expect(rows.length).toBe(1) // ledger-tracked: o gasto de catálogo é registrado
    expect(rows[0].costUsd).not.toBeNull() // custo REAL (usage+model threaded), nunca NULL silencioso
    expect(rows[0].model).not.toBeNull()
  })

  it('gerar duas vezes acumula a galeria (não descarta) e re-selecionar via select troca a face', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()
    await catGen(jsonReq(`http://localhost/x`, cur), ctx(draft))
    const r2 = await catGen(jsonReq(`http://localhost/x`, cur), ctx(draft))
    const g2 = (await r2.json()) as { gallery: { id: string; selected: boolean }[] }
    expect(g2.gallery.length).toBe(2)
    const faceId = await imageIdOf(draft)
    const other = g2.gallery.find((x) => x.id !== faceId)!
    const sel = await catSelect(jsonReq(`http://localhost/x`, cur), ctx2(draft, other.id))
    expect(sel.status).toBe(200)
    expect(await imageIdOf(draft)).toBe(other.id)
  })
})

describe('Edição de catálogo — ingredientes + tempos', () => {
  it('PATCH com ingredientes REESCREVE a lista (persiste, não some)', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()
    const res = await catEdit(
      jsonReq(`http://localhost/x`, cur, 'PATCH', {
        locale: 'pt-BR',
        ingredientes: [
          { rawText: 'camarão', quantidade: '0.300', unidade: 'kg' },
          { rawText: 'leite de coco', quantidade: '200', unidade: 'ml' },
        ],
      }),
      ctx(draft),
    )
    expect(res.status).toBe(200)
    const rows = await getDb()
      .select({ rawText: recipeIngredient.rawText })
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, draft))
      .orderBy(recipeIngredient.ordem)
    expect(rows.map((r) => r.rawText)).toEqual(['camarão', 'leite de coco'])
  })

  it('PATCH com tempo ativo > total é RECONCILIADO (não 500 pelo CHECK)', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()
    const res = await catEdit(
      jsonReq(`http://localhost/x`, cur, 'PATCH', { tempoAtivoMin: 40, tempoTotalMin: 20 }),
      ctx(draft),
    )
    expect(res.status).toBe(200)
    const [r] = await getDb()
      .select({ a: recipe.tempoAtivoMin, t: recipe.tempoTotalMin })
      .from(recipe)
      .where(eq(recipe.id, draft))
    // conciliarTempoPreparo: ativo > total ⇒ ativo descartado (null), total preservado.
    expect(r.t).toBe(20)
    expect(r.a).toBeNull()
  })
})

describe('GET curador-aware', () => {
  it('devolve RecipeView + gallery, sem owner_id/id interno', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft('Vatapá')
    await catGen(jsonReq(`http://localhost/x`, cur), ctx(draft)) // dá 1 imagem na galeria

    const res = await catGet(jsonReq(`http://localhost/x`, cur, 'GET'), ctx(draft))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { view: Record<string, unknown>; gallery: unknown[] }
    expect(body.view.name).toContain('Vatapá')
    expect(Array.isArray(body.gallery)).toBe(true)
    expect(body.gallery.length).toBe(1)
    // não vaza owner_id (o RecipeView não carrega) nem campos owner-gated (canManage false).
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('owner_id')
    expect(raw).not.toContain('ownerId')
    expect(body.view.canManage).toBeUndefined()
    expect(body.view.gallery).toBeUndefined() // gallery é sibling top-level, NUNCA dentro da view
  })
})

describe('Auto-gen na aprovação (best-effort)', () => {
  it('aprovar SEM face ⇒ gera + seleciona uma imagem', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()
    expect(await imageIdOf(draft)).toBeNull()

    const res = await approveRoute(jsonReq(`http://localhost/x`, cur), ctx(draft))
    expect(res.status).toBe(200)
    expect(await imageIdOf(draft)).not.toBeNull()
    expect(await countImages(draft)).toBe(1)
  })

  it('aprovar COM face não-moderada ⇒ NÃO gera de novo (sem cobrança dupla)', async () => {
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()
    await catGen(jsonReq(`http://localhost/x`, cur), ctx(draft)) // 1 face
    expect(await countImages(draft)).toBe(1)

    const res = await approveRoute(jsonReq(`http://localhost/x`, cur), ctx(draft))
    expect(res.status).toBe(200)
    expect(await countImages(draft)).toBe(1) // não acrescentou
  })

  it('aprovar com face MODERADA ⇒ GERA nova (dec.12: não publica com placeholder moderado)', async () => {
    const { headers: cur, userId: curId } = await curator()
    const draft = await seedCatalogDraft()
    // face MODERADA selecionada (o curador #133 escondeu): hasNonModeratedFace=false ⇒ auto-gen gera.
    await seedRecipeImage({ recipeId: draft, provenance: 'ai_generated', moderated: { curatorId: curId } })
    expect(await countImages(draft)).toBe(1)

    const res = await approveRoute(jsonReq(`http://localhost/x`, cur), ctx(draft))
    expect(res.status).toBe(200)
    expect(await countImages(draft)).toBe(2) // gerou uma face nova (não-moderada)
  })

  it('gerador INDISPONÍVEL ⇒ aprovação ainda 200 (best-effort não bloqueia)', async () => {
    setImageGenerator(new ThrowingImageGenerator())
    const { headers: cur } = await curator()
    const draft = await seedCatalogDraft()

    const res = await approveRoute(jsonReq(`http://localhost/x`, cur), ctx(draft))
    expect(res.status).toBe(200)
    const [r] = await getDb().select({ s: recipe.curationStatus }).from(recipe).where(eq(recipe.id, draft))
    expect(r.s).toBe('approved')
    expect(await imageIdOf(draft)).toBeNull() // sem imagem, mas aprovada
  })
})
