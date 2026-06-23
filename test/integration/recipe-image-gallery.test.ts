import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb, setImageStore, setImageGenerator, setClaudeClient, setEmbedder } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator } from '@/server/images/image-generator'
import { FakeClaudeClient } from '@/server/claude/client'
import type { Embedder } from '@/server/embedding/embedder'
import { recipe, recipeImage, creationSession, EMBEDDING_DIMENSIONS } from '@/db/schema'
import { POST as generateRoute } from '@/app/api/recipes/[id]/image/generate/route'
import { POST as selectRoute } from '@/app/api/recipes/[id]/images/[imageId]/select/route'
import { DELETE as galleryDeleteRoute } from '@/app/api/recipes/[id]/images/[imageId]/route'
import { POST as regenerateRoute } from '@/app/api/recipes/[id]/regenerate/route'
import { GET as detailGET } from '@/app/api/recipes/[id]/route'
import { loadPublicRecipeBySlug } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedRecipeImage } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { cannedSuccess } from '../helpers/generation'

/**
 * Galeria de imagens re-selecionável (#222, ADR-0022) — select/delete/gallery + projeção pública.
 * FakeImageStore/FakeImageGenerator (sem rede). Cobre: gerar APPENDA preview deselecionada e NÃO toca
 * a face pública (anon vê a antiga, nunca a fresca); a galeria é OWNER-GATED (a vista pública por uuid
 * E por slug nunca a tem); ordenação por created_at; selecionar repointa a face (sem ledger/reap);
 * selecionar imagem de OUTRA linhagem ⇒ um not_found (= não-dono); apagar remove a linha + reapa o
 * blob (caminho real generate→delete); apagar a face em uso ⇒ in_use (409), inclusive a face ainda
 * referenciada por uma VERSÃO ANTERIOR (ref-count GLOBAL cross-version); apagar de outra linhagem ⇒ not_found.
 */

class FakeEmbedder implements Embedder {
  async embed(): Promise<number[]> {
    return new Array(EMBEDDING_DIMENSIONS).fill(0.1)
  }
}

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

let store: FakeImageStore
beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
  setImageGenerator(new FakeImageGenerator())
  // Regenerar (#20) embeda a nova versão (best-effort) e chama o Claude — Fakes p/ sem rede.
  setEmbedder(new FakeEmbedder())
  setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
})

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ctx2 = (id: string, imageId: string) => ({ params: Promise.resolve({ id, imageId }) })

function genReq(id: string, headers: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/image/generate`, { method: 'POST', headers })
}
function selectReq(id: string, imageId: string, headers: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/images/${imageId}/select`, { method: 'POST', headers })
}
function deleteReq(id: string, imageId: string, headers: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/images/${imageId}`, { method: 'DELETE', headers })
}

async function imageIdOf(recipeId: string): Promise<string | null> {
  const [r] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, recipeId))
  return r?.imageId ?? null
}
async function countImages(): Promise<number> {
  const [r] = await getDb().select({ n: dsql<number>`count(*)::int` }).from(recipeImage)
  return r?.n ?? 0
}

async function seedOwned(ownerId: string, titulo = 'Bolo'): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'automatica_nao_revisada' })
  await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'farinha', quantidade: null })
  return id
}

function regenReq(id: string, headers: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/regenerate`, { method: 'POST', headers })
}
/** Receita ai_free_text PRÓPRIA com sessão recuperável (fonte free_text) — regenerável. */
async function seedRegenerable(ownerId: string, titulo: string): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_free_text', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'automatica_nao_revisada' })
  await getDb()
    .insert(creationSession)
    .values({ userId: ownerId, mode: 'free_text', recipeId: id, freeText: 'um prato qualquer pra quatro' })
  return id
}

describe('Galeria de imagens (#222) — preview + projeção pública', () => {
  it('gerar APPENDA uma preview deselecionada; a face pública NÃO muda (anon vê a antiga)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'preview-pub@g.test' })
    // Receita PÚBLICA com uma face inicial.
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: userId, visibility: 'public', cozinha: 'brasileira' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Pão', provenance: 'escrita_por_pessoa' })
    const oldFace = await seedRecipeImage({ recipeId: id, blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/old.webp' })

    const res = await generateRoute(genReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { image: { id: string } }
    expect(body.image.id).not.toBe(oldFace)

    // A face pública seguiu a ANTIGA (preview não seleciona).
    expect(await imageIdOf(id)).toBe(oldFace)

    // O GET PÚBLICO ANÔNIMO ainda devolve a URL da face ANTIGA — nunca a preview fresca.
    const pub = await detailGET(new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`), ctx(id))
    const pubView = (await pub.json()) as { imageUrl?: string; gallery?: unknown }
    expect(pubView.imageUrl).toBe('https://abc.public.blob.vercel-storage.com/recipes/old.webp')
    expect(pubView.gallery).toBeUndefined() // a galeria NUNCA vaza no público
  })

  it('a GALERIA é owner-gated: o DONO a vê (com a preview); a vista pública NUNCA tem o campo', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gallery-owner@g.test' })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: userId, visibility: 'public', cozinha: 'brasileira' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Torta', provenance: 'escrita_por_pessoa' })
    await generateRoute(genReq(id, headers), ctx(id)) // 1 preview na galeria

    // GET do DONO (com cookie) ⇒ tem a galeria com 1 imagem (deselecionada).
    const ownerRes = await detailGET(
      new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers }),
      ctx(id),
    )
    const ownerView = (await ownerRes.json()) as { gallery?: { id: string; aiGenerated: boolean; selected: boolean }[] }
    expect(ownerView.gallery).toBeDefined()
    expect(ownerView.gallery!.length).toBe(1)
    expect(ownerView.gallery![0]).toMatchObject({ aiGenerated: true, selected: false })

    // GET de OUTRO usuário logado (não-dono) ⇒ pública, mas SEM galeria.
    const { headers: otherHeaders } = await seedSessionHeaders({ email: 'gallery-other@g.test' })
    const otherRes = await detailGET(
      new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers: otherHeaders }),
      ctx(id),
    )
    const otherView = (await otherRes.json()) as { gallery?: unknown; canManage?: boolean }
    expect(otherView.canManage).toBeUndefined()
    expect(otherView.gallery).toBeUndefined()
  })

  it('#222 leitura PÚBLICA por SLUG: anon vê a face SELECIONADA e NUNCA o campo gallery (mesmo com 2+ imagens)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'byslug@g.test' })
    // Receita PÚBLICA com slug + face inicial; gera mais previews (2+ imagens na galeria).
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: userId, visibility: 'public', cozinha: 'brasileira' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Pizza', provenance: 'escrita_por_pessoa', slug: 'pizza' })
    const face = await seedRecipeImage({ recipeId: id, blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/face.webp' })
    await generateRoute(genReq(id, headers), ctx(id)) // preview #1
    await generateRoute(genReq(id, headers), ctx(id)) // preview #2
    expect(await imageIdOf(id)).toBe(face) // a face seguiu a selecionada inicial

    // Seam ANÔNIMO por slug (o que a página indexável usa). Monta a view PÚBLICA (sem viewerId).
    const rows = await loadPublicRecipeBySlug(getDb(), 'pizza', 'pt-BR')
    expect(rows).not.toBeNull()
    const view = resolveRecipeView({ ...rows!, requestLocale: 'pt-BR' })
    expect(view.imageUrl).toBe('https://abc.public.blob.vercel-storage.com/recipes/face.webp') // só a face
    expect(view.gallery).toBeUndefined() // a galeria NUNCA vaza no caminho por slug
    expect(view.canManage).toBeUndefined()
  })

  it('#222 a galeria respeita a ordem de created_at (asc) — contrato que a UI renderiza', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'order@g.test' })
    const id = await seedOwned(userId)
    const g1 = (await (await generateRoute(genReq(id, headers), ctx(id))).json()) as { image: { id: string } }
    const g2 = (await (await generateRoute(genReq(id, headers), ctx(id))).json()) as { image: { id: string } }
    const g3 = (await (await generateRoute(genReq(id, headers), ctx(id))).json()) as { image: { id: string } }

    const res = await detailGET(new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers }), ctx(id))
    const view = (await res.json()) as { gallery?: { id: string }[] }
    expect(view.gallery!.map((g) => g.id)).toEqual([g1.image.id, g2.image.id, g3.image.id])
  })

  it('selecionar a preview repointa a face (sem reap); a galeria mantém todas', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'select@g.test' })
    const id = await seedOwned(userId)
    const face0 = await seedRecipeImage({ recipeId: id }) // face inicial (na galeria)

    const gen = (await (await generateRoute(genReq(id, headers), ctx(id))).json()) as { image: { id: string } }
    expect(await imageIdOf(id)).toBe(face0) // preview não trocou a face

    const res = await selectRoute(selectReq(id, gen.image.id, headers), ctx2(id, gen.image.id))
    expect(res.status).toBe(200)
    expect(await imageIdOf(id)).toBe(gen.image.id) // agora a face é a gerada
    // Nenhum reap: ambas as imagens continuam na tabela.
    expect(await countImages()).toBe(2)
    // A view do dono reflete: a gerada está selected, a antiga não.
    const view = (await res.json()) as { gallery?: { id: string; selected: boolean }[] }
    const sel = view.gallery!.find((g) => g.selected)
    expect(sel?.id).toBe(gen.image.id)
  })

  it('selecionar imagem de OUTRA linhagem ⇒ um not_found (= não-dono, leak-safe)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'select-foreign@g.test' })
    const mine = await seedOwned(userId, 'Minha')
    // Uma Receita SEPARADA (linhagem distinta) do MESMO dono, com sua própria imagem.
    const other = await seedOwned(userId, 'Outra')
    const foreignImage = await seedRecipeImage({ recipeId: other })

    const res = await selectRoute(selectReq(mine, foreignImage, headers), ctx2(mine, foreignImage))
    expect(res.status).toBe(404) // imagem de outra linhagem ⇒ not_found
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
    expect(await imageIdOf(mine)).toBeNull() // face intacta
  })

  it('selecionar imagem inexistente ⇒ not_found; não-dono ⇒ not_found', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'select-nx@g.test' })
    const id = await seedOwned(userId)
    const ghost = '00000000-0000-0000-0000-000000000000'
    expect((await selectRoute(selectReq(id, ghost, headers), ctx2(id, ghost))).status).toBe(404)

    // Não-dono: mesmo not_found.
    const owner2 = await seedUser({ email: 'other-own@g.test' })
    const others = await seedOwned(owner2)
    const othersImg = await seedRecipeImage({ recipeId: others })
    expect((await selectRoute(selectReq(others, othersImg, headers), ctx2(others, othersImg))).status).toBe(404)
  })

  it('caminho real append→delete→reap: gerar 2 previews, selecionar a 1ª, apagar a 2ª (não-ref) ⇒ linha + blob somem', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'delete@g.test' })
    const id = await seedOwned(userId)

    // Gera DUAS previews pelo caminho REAL (generateRoute → createGalleryImage guarda blobs reais).
    const g1 = (await (await generateRoute(genReq(id, headers), ctx(id))).json()) as { image: { id: string; url: string } }
    const g2 = (await (await generateRoute(genReq(id, headers), ctx(id))).json()) as { image: { id: string; url: string } }
    expect(store.blobs.has(g1.image.url)).toBe(true)
    expect(store.blobs.has(g2.image.url)).toBe(true)
    expect(await countImages()).toBe(2)

    // Seleciona a 1ª como face ⇒ a 2ª fica NÃO-referenciada (apagável).
    await selectRoute(selectReq(id, g1.image.id, headers), ctx2(id, g1.image.id))
    expect(await imageIdOf(id)).toBe(g1.image.id)

    const res = await galleryDeleteRoute(deleteReq(id, g2.image.id, headers), ctx2(id, g2.image.id))
    expect(res.status).toBe(200)
    // A linha da 2ª sumiu e o blob foi reapado de verdade; a face (1ª) intacta.
    const [gone] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, g2.image.id))
    expect(gone).toBeUndefined()
    expect(store.blobs.has(g2.image.url)).toBe(false) // reapado
    expect(store.blobs.has(g1.image.url)).toBe(true) // a face permanece
    expect(await imageIdOf(id)).toBe(g1.image.id)
    expect(await countImages()).toBe(1)
  })

  it('apagar a face em uso (referenciada) ⇒ in_use (409); nada destruído', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'delete-inuse@g.test' })
    const id = await seedOwned(userId)
    const face = await seedRecipeImage({ recipeId: id }) // É a face (referenciada)

    const res = await galleryDeleteRoute(deleteReq(id, face, headers), ctx2(id, face))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'in_use' })
    // A imagem segue existindo (não destruída).
    const [still] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, face))
    expect(still).toBeDefined()
    expect(await imageIdOf(id)).toBe(face)
  })

  it('#222 in_use GLOBAL cross-version: a face ainda referenciada por uma VERSÃO ANTERIOR não é apagável', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'delete-crossver@g.test' })
    // V1 regenerável com uma face F (referenciada por V1).
    const v1 = await seedRegenerable(userId, 'Versão 1')
    const face = await seedRecipeImage({ recipeId: v1 })

    // Regenera (same-owner) ⇒ V2 COMPARTILHA a linhagem e CARRY-FORWARD da face (V2.image_id = F).
    const regen = await regenerateRoute(regenReq(v1, headers), ctx(v1))
    expect(regen.status).toBe(201)
    const v2 = ((await regen.json()) as { recipeId: string }).recipeId
    expect(await imageIdOf(v2)).toBe(face) // carry-forward p/ a nova versão
    // Ambas referenciam F agora (V1 e V2) — ref-count GLOBAL = 2.

    // DESSELECIONA na versão ATUAL (V2) — V1 AINDA referencia F (ref-count GLOBAL cai p/ 1, não 0).
    await getDb().update(recipe).set({ imageId: null }).where(eq(recipe.id, v2))

    // Apagar F pela galeria da V2 → BLOQUEADO (V1 ainda a referencia) — ref-count GLOBAL, não
    // current-recipe-only. Se o COUNT fosse só da V2, isto passaria (verde-falso) — daí o teste.
    const del = await galleryDeleteRoute(deleteReq(v2, face, headers), ctx2(v2, face))
    expect(del.status).toBe(409)
    await expect(del.json()).resolves.toMatchObject({ error: 'in_use' })
    // A linha SOBREVIVE (V1 ainda a usa).
    const [still] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, face))
    expect(still).toBeDefined()
    expect(await imageIdOf(v1)).toBe(face) // V1 segue apontando F
  })

  it('apagar imagem de OUTRA linhagem ⇒ not_found (leak-safe)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'delete-foreign@g.test' })
    const mine = await seedOwned(userId, 'Minha')
    const other = await seedOwned(userId, 'Outra')
    const foreignImage = await seedRecipeImage({ recipeId: other })

    const res = await galleryDeleteRoute(deleteReq(mine, foreignImage, headers), ctx2(mine, foreignImage))
    expect(res.status).toBe(404)
    const [still] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, foreignImage))
    expect(still).toBeDefined() // não tocada
  })

  it('anon select/delete → 401; não-dono → 404', async () => {
    const owner = await seedUser({ email: 'anon-owner@g.test' })
    const id = await seedOwned(owner)
    const face = await seedRecipeImage({ recipeId: id })

    // anon
    expect((await selectRoute(selectReq(id, face, new Headers()), ctx2(id, face))).status).toBe(401)
    expect((await galleryDeleteRoute(deleteReq(id, face, new Headers()), ctx2(id, face))).status).toBe(401)

    // não-dono
    const { headers } = await seedSessionHeaders({ email: 'anon-intruso@g.test' })
    expect((await selectRoute(selectReq(id, face, headers), ctx2(id, face))).status).toBe(404)
    expect((await galleryDeleteRoute(deleteReq(id, face, headers), ctx2(id, face))).status).toBe(404)
  })
})

/**
 * #225 — Moderação × galeria (ADR-0022): a moderação por-imagem (#133, flag ortogonal à Visibilidade)
 * encontra a galeria re-selecionável. Cobre: a galeria do DONO marca a imagem moderada (`moderated:true`);
 * SELECIONAR uma imagem moderada é BLOQUEADO (409 imagem_moderada, image_id intocado — "moderada não
 * vira face pública" no seam); e o gate público do #133 segue valendo (uma face selecionada-depois-moderada
 * vira placeholder no caminho público-por-slug, enquanto o dono ainda a vê).
 */
describe('Galeria × moderação (#225) — imagem moderada não vira face pública', () => {
  it('loadGallery marca a imagem MODERADA com moderated:true (e a não-moderada com false) na view do dono', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gal-moder@g.test' })
    const curId = await seedUser({ email: 'gal-moder-cur@g.test' })
    const id = await seedOwned(userId, 'Bolo')
    // 1ª imagem: vira a face e fica MODERADA. 2ª imagem: limpa.
    const moderada = await seedRecipeImage({ recipeId: id, moderated: { curatorId: curId } })
    const limpa = await seedRecipeImage({ recipeId: id })

    const res = await detailGET(new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers }), ctx(id))
    const view = (await res.json()) as { gallery?: { id: string; moderated: boolean }[] }
    expect(view.gallery).toBeDefined()
    const byId = new Map(view.gallery!.map((g) => [g.id, g.moderated]))
    expect(byId.get(moderada)).toBe(true)
    expect(byId.get(limpa)).toBe(false)
  })

  it('uma imagem MODERADA NÃO-selecionada ainda é APAGÁVEL (o bloqueio de select NÃO vaza p/ o delete)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del-moder@g.test' })
    const curId = await seedUser({ email: 'del-moder-cur@g.test' })
    const id = await seedOwned(userId, 'Pudim')
    // Face LIMPA selecionada + uma 2ª imagem MODERADA e NÃO-selecionada (apagável: nenhuma versão a referencia).
    const limpa = await seedRecipeImage({ recipeId: id })
    const moderada = await seedRecipeImage({ recipeId: id, moderated: { curatorId: curId } })
    // A 2ª seed moveu image_id p/ a moderada — reaponta a face de volta p/ a limpa.
    await getDb().update(recipe).set({ imageId: limpa }).where(eq(recipe.id, id))
    expect(await imageIdOf(id)).toBe(limpa)
    expect(await countImages()).toBe(2)

    // APAGAR a moderada (não-selecionada, sem refs) ⇒ 200; a linha some. O bloqueio é só do SELECT
    // (moderada não vira face); apagar uma moderada continua permitido (guarda contra regressão de
    // "bloquear ops em linhas moderadas" que silenciosamente quebraria o delete).
    const res = await galleryDeleteRoute(deleteReq(id, moderada, headers), ctx2(id, moderada))
    expect(res.status).toBe(200)
    const [gone] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, moderada))
    expect(gone).toBeUndefined()
    expect(await countImages()).toBe(1)
    expect(await imageIdOf(id)).toBe(limpa) // a face limpa intacta
  })

  it('selecionar uma imagem MODERADA ⇒ 409 imagem_moderada; image_id NÃO muda (moderada não vira face)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'sel-moder@g.test' })
    const curId = await seedUser({ email: 'sel-moder-cur@g.test' })
    const id = await seedOwned(userId, 'Torta')
    // Face limpa inicial + uma imagem moderada (NÃO-selecionada) na mesma galeria.
    const limpa = await seedRecipeImage({ recipeId: id }) // seedRecipeImage aponta image_id p/ a última
    const moderada = await seedRecipeImage({ recipeId: id, moderated: { curatorId: curId } })
    // Reaponta a face de volta p/ a limpa (a 2ª seed moveu image_id pra moderada).
    await getDb().update(recipe).set({ imageId: limpa }).where(eq(recipe.id, id))
    expect(await imageIdOf(id)).toBe(limpa)

    const res = await selectRoute(selectReq(id, moderada, headers), ctx2(id, moderada))
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'imagem_moderada' })
    // A face seguiu a limpa — selecionar a moderada NÃO a tornou pública.
    expect(await imageIdOf(id)).toBe(limpa)
  })

  it('#133 gate público persiste: uma face selecionada-depois-moderada cai pro placeholder no caminho por SLUG; o dono ainda a vê', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gate-moder@g.test' })
    const curId = await seedUser({ email: 'gate-moder-cur@g.test' })
    // Receita PÚBLICA com slug; a face é a imagem que SERÁ moderada.
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: userId, visibility: 'public', cozinha: 'brasileira' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Quibe', provenance: 'escrita_por_pessoa', slug: 'quibe' })
    const face = await seedRecipeImage({
      recipeId: id,
      blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/quibe.webp',
      moderated: { curatorId: curId },
    })
    expect(await imageIdOf(id)).toBe(face) // a moderada É a face selecionada

    // Caminho ANÔNIMO por slug (página indexável): a foto moderada some ⇒ placeholder.
    const rows = await loadPublicRecipeBySlug(getDb(), 'quibe', 'pt-BR')
    expect(rows).not.toBeNull()
    const anonView = resolveRecipeView({ ...rows!, requestLocale: 'pt-BR' })
    expect(anonView.imageUrl).toBeUndefined() // gate #133: público vê placeholder

    // O DONO (canManage) AINDA vê a própria imagem moderada (face) e a galeria marca-a moderated.
    const ownerRes = await detailGET(new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, { headers }), ctx(id))
    const ownerView = (await ownerRes.json()) as { imageUrl?: string; gallery?: { id: string; moderated: boolean }[] }
    expect(ownerView.imageUrl).toBe('https://abc.public.blob.vercel-storage.com/recipes/quibe.webp')
    expect(ownerView.gallery!.find((g) => g.id === face)?.moderated).toBe(true)
  })
})
