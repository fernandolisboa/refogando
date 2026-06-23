import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb, setImageStore, setImageGenerator } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator } from '@/server/images/image-generator'
import { recipe, recipeImage } from '@/db/schema'
import { POST as generateRoute } from '@/app/api/recipes/[id]/image/generate/route'
import { POST as selectRoute } from '@/app/api/recipes/[id]/images/[imageId]/select/route'
import { DELETE as galleryDeleteRoute } from '@/app/api/recipes/[id]/images/[imageId]/route'
import { GET as detailGET } from '@/app/api/recipes/[id]/route'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedRecipeImage } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Galeria de imagens re-selecionável (#222, ADR-0022) — select/delete/gallery + projeção pública.
 * FakeImageStore/FakeImageGenerator (sem rede). Cobre: gerar APPENDA preview deselecionada e NÃO toca
 * a face pública (anon vê a antiga, nunca a fresca); a galeria é OWNER-GATED (a vista pública nunca a
 * tem); selecionar repointa a face (sem ledger/reap); selecionar imagem de OUTRA linhagem ⇒ um
 * not_found (= não-dono); apagar remove a linha + reapa o blob; apagar a face em uso ⇒ in_use (409);
 * apagar imagem de outra linhagem ⇒ not_found.
 */

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

  it('apagar uma imagem NÃO-referenciada remove a linha + reapa o blob', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'delete@g.test' })
    const id = await seedOwned(userId)
    const face = await seedRecipeImage({ recipeId: id }) // selecionada (face)
    const blobUrl = 'https://fake-blob.local/recipes/extra.png'
    // Uma 2ª imagem na MESMA linhagem, NÃO selecionada — guardada no store fake para o reap conferir.
    await store.store({ data: Buffer.from([9]), contentType: 'image/png', pathPrefix: 'recipes' })
    const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, id))
    const [extra] = await getDb()
      .insert(recipeImage)
      .values({ blobUrl, provenance: 'ai_generated', lineageId: r.lineageId })
      .returning({ id: recipeImage.id })
    store.blobs.set(blobUrl, { contentType: 'image/png', bytes: new Uint8Array([9]) })

    const res = await galleryDeleteRoute(deleteReq(id, extra.id, headers), ctx2(id, extra.id))
    expect(res.status).toBe(200)
    // A linha sumiu e o blob foi reapado; a face (outra imagem) intacta.
    const [gone] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, extra.id))
    expect(gone).toBeUndefined()
    expect(store.blobs.has(blobUrl)).toBe(false)
    expect(await imageIdOf(id)).toBe(face)
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
