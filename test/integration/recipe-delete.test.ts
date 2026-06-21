import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setImageStore } from '@/server/deps'
import { recipe, recipeImage } from '@/db/schema'
import { FakeImageStore } from '@/server/images/image-store'
import { DELETE as deleteRoute } from '@/app/api/recipes/[id]/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { deriveRecipe } from '@/server/recipe/derive'
import type { DerivedDiff } from '@/domain/recipe-diff'
import { seedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedRecipeIngredient,
  seedRecipeImage,
  seedTag,
  linkRecipeTag,
  seedVote,
  seedFavorite,
} from '../helpers/recipes'

/**
 * APAGAR a própria receita (#21) — HARD delete: um único `DELETE FROM recipe WHERE id AND
 * owner_id` que CASCATEIA os filhos (traduções/itens/tags/votos/favoritos/embedding/report)
 * e faz SET NULL nas refs FRACAS (parent_recipe_id de derivadas de terceiros, etc). Porta
 * mais alta (handler DELETE). Modelo: recipe-derive.test.ts.
 */

let sql: Sql
// #146: o delete roda o ref-count da Imagem injetando o ImageStore. FakeImageStore (host
// `fake-blob.local` que `owns` reconhece) por teste — `blobs` prova o blob apagado/preservado.
let store: FakeImageStore

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

beforeEach(() => {
  // Roda APÓS o resetDeps() do setup.ts global (que zera o override) ⇒ a rota DELETE usa este Fake.
  store = new FakeImageStore()
  setImageStore(store)
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function del(id: string, headers?: Headers): Promise<Response> {
  return deleteRoute(
    new Request(`http://localhost/api/recipes/${id}`, {
      method: 'DELETE',
      headers: headers ? Object.fromEntries(headers) : {},
    }),
    { params: Promise.resolve({ id }) },
  )
}

function get(id: string, headers?: Headers): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

async function recipeExists(id: string): Promise<boolean> {
  const [row] = await getDb().select({ id: recipe.id }).from(recipe).where(eq(recipe.id, id))
  return row != null
}

/** #146: a linha recipe_image (pelo id) ainda existe? (prova do reap/ref-count.) */
async function imageExists(imageId: string): Promise<boolean> {
  const [row] = await getDb().select({ id: recipeImage.id }).from(recipeImage).where(eq(recipeImage.id, imageId))
  return row != null
}

async function countTable(table: string, recipeId: string): Promise<number> {
  const [r] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM ${sql(table)} WHERE recipe_id = ${recipeId}`
  return r.c
}

/** Semeia uma receita do dono com tradução + ingrediente + tag + voto + favorito. */
async function seedOwnComplete(ownerId: string, voterId: string, visibility: 'private' | 'public'): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility, ownerId })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Receita', provenance: 'escrita_por_pessoa' })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'sal' })
  const tagId = await seedTag('teste')
  await linkRecipeTag(id, tagId)
  await seedVote({ userId: voterId, recipeId: id })
  await seedFavorite({ userId: voterId, recipeId: id })
  return id
}

describe('DELETE /api/recipes/[id] — apagar a própria receita (#21)', () => {
  // (a) apagar a própria ⇒ 204; linha some; filhos cascatam (contagens = 0).
  it('(a) apagar a própria ⇒ 204; linha some; cascata zera traduções/itens/tags/votos/favoritos', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del-own@ex.com' })
    const { userId: voterId } = await seedSessionHeaders({ email: 'del-voter@ex.com' })
    const id = await seedOwnComplete(userId, voterId, 'private')

    const res = await del(id, headers)
    expect(res.status).toBe(204)

    expect(await recipeExists(id)).toBe(false)
    expect(await countTable('recipe_translation', id)).toBe(0)
    expect(await countTable('recipe_ingredient', id)).toBe(0)
    expect(await countTable('recipe_tag', id)).toBe(0)
    expect(await countTable('recipe_vote', id)).toBe(0)
    expect(await countTable('recipe_favorite', id)).toBe(0)
  })

  // (b) apagar uma base de DERIVADA de TERCEIRO ⇒ derivada sobrevive com snapshot;
  //     parent_recipe_id vira NULL; o GET dela sinaliza o vínculo perdido.
  it('(b) apagar a base ⇒ derivada de terceiro sobrevive (snapshot intacto), parent NULL, vínculo perdido', async () => {
    const { userId: ownerA, headers: headersA } = await seedSessionHeaders({ email: 'del-baseA@ex.com' })
    const { userId: viewerB, headers: headersB } = await seedSessionHeaders({ email: 'del-derivB@ex.com' })

    // Base pública de A.
    const baseId = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: ownerA })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Bolo base', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId: baseId, ordem: 0, rawText: 'fubá' })

    // B deriva a base de A (fork real).
    const derived = await deriveRecipe({
      db: getDb(),
      baseId,
      viewerId: viewerB,
      edits: {
        titulo: 'Bolo de fubá com erva-doce',
        descricao: null,
        passos: null,
        notas: null,
        ingredientes: [{ rawText: 'fubá', quantidade: null, unidade: null }],
        restricoes: [],
      },
      locale: 'pt-BR',
    })
    expect(derived.kind).toBe('ok')
    const derivedId = (derived as { kind: 'ok'; recipeId: string }).recipeId

    // A apaga a base.
    const res = await del(baseId, headersA)
    expect(res.status).toBe(204)
    expect(await recipeExists(baseId)).toBe(false)

    // A derivada de B SOBREVIVE com snapshot completo; parent_recipe_id virou NULL.
    expect(await recipeExists(derivedId)).toBe(true)
    const [row] = await getDb()
      .select({
        parentRecipeId: recipe.parentRecipeId,
        lineageKind: recipe.lineageKind,
        derivedDiff: recipe.derivedDiff,
      })
      .from(recipe)
      .where(eq(recipe.id, derivedId))
    expect(row.parentRecipeId).toBeNull()
    expect(row.lineageKind).toBe('edited')
    expect(row.derivedDiff).not.toBeNull()
    expect(await countTable('recipe_translation', derivedId)).toBeGreaterThan(0)

    // O GET de B (dono da derivada) sinaliza o vínculo perdido (base apagada).
    const view = (await (await get(derivedId, headersB)).json()) as {
      vinculoPerdido?: boolean
      derivedDiff?: DerivedDiff
    }
    expect(view.vinculoPerdido).toBe(true)
    expect(view.derivedDiff).toBeDefined()
  })

  // (c) apagar a própria PÚBLICA ⇒ sai do pool (anônimo GET ⇒ 404).
  it('(c) apagar a própria pública ⇒ sai do pool (anônimo ⇒ 404)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del-pub@ex.com' })
    const { userId: voterId } = await seedSessionHeaders({ email: 'del-pub-voter@ex.com' })
    const id = await seedOwnComplete(userId, voterId, 'public')

    // Antes: anônimo lê a pública.
    expect((await get(id)).status).toBe(200)

    const res = await del(id, headers)
    expect(res.status).toBe(204)

    // Depois: anônimo ⇒ 404.
    expect((await get(id)).status).toBe(404)
  })

  // (d) não-dono ⇒ 404; Visitante ⇒ 401; catálogo (ownerId NULL) ⇒ 404; linha intacta.
  it('(d) não-dono ⇒ 404; Visitante ⇒ 401; catálogo ⇒ 404; a linha NÃO é apagada', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del-ownerA@ex.com' })
    const { headers: otherHeaders } = await seedSessionHeaders({ email: 'del-ownerB@ex.com' })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: userId })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Intocável', provenance: 'escrita_por_pessoa' })

    // Não-dono ⇒ 404 (leak-safe, nunca 403).
    const nonOwner = await del(id, otherHeaders)
    expect(nonOwner.status).toBe(404)
    await expect(nonOwner.json()).resolves.toMatchObject({ error: 'not_found' })
    expect(await recipeExists(id)).toBe(true)

    // Visitante ⇒ 401.
    const visitor = await del(id)
    expect(visitor.status).toBe(401)
    await expect(visitor.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await recipeExists(id)).toBe(true)

    // Catálogo (ownerId NULL) ⇒ 404 mesmo logado; não apaga.
    const catalogId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: catalogId, locale: 'pt-BR', titulo: 'Catálogo', provenance: 'escrita_por_pessoa' })
    const catalog = await del(catalogId, headers)
    expect(catalog.status).toBe(404)
    expect(await recipeExists(catalogId)).toBe(true)
  })

  // (e) id malformado ⇒ 404 sem 500; uuid inexistente ⇒ 404.
  it('(e) id não-uuid ⇒ 404; uuid inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'del-badid@ex.com' })
    expect((await del('not-a-uuid', headers)).status).toBe(404)
    expect((await del('00000000-0000-0000-0000-000000000000', headers)).status).toBe(404)
  })

  // (f) #146: apagar a ÚLTIMA versão que referencia uma imagem ⇒ recipe_image + blob são reapados.
  it('(f) #146: apagar a última versão com imagem ⇒ recipe_image e blob somem (ref-count)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del-img-last@ex.com' })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId: userId })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Com foto', provenance: 'escrita_por_pessoa' })
    // Guarda o blob no Fake (URL em fake-blob.local, que `owns` reconhece) e aponta a recipe_image pra ele.
    const { url } = await store.store({ data: Buffer.from([1, 2, 3, 4]), contentType: 'image/webp', pathPrefix: 'recipes' })
    const imageId = await seedRecipeImage({ recipeId: id, blobUrl: url })
    expect(store.blobs.has(url)).toBe(true)

    expect((await del(id, headers)).status).toBe(204)
    expect(await recipeExists(id)).toBe(false)
    expect(await imageExists(imageId)).toBe(false) // linha recipe_image órfã reapada
    expect(store.blobs.has(url)).toBe(false) // blob apagado best-effort (store.owns ⇒ deletou)
  })

  // (g) #146: imagem COMPARTILHADA por 2 versões (carry-forward #131) ⇒ apagar uma MANTÉM a imagem
  //     (a outra ainda referencia); só ao apagar a ÚLTIMA é que recipe_image + blob são reapados.
  it('(g) #146: imagem compartilhada ⇒ apagar uma versão preserva; apagar a última reapa', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del-img-shared@ex.com' })
    const a = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId: userId })
    await seedTranslation({ recipeId: a, locale: 'pt-BR', titulo: 'Versão A', provenance: 'escrita_por_pessoa' })
    const b = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', ownerId: userId })
    await seedTranslation({ recipeId: b, locale: 'pt-BR', titulo: 'Versão B', provenance: 'escrita_por_pessoa' })
    const { url } = await store.store({ data: Buffer.from([5, 6, 7, 8]), contentType: 'image/webp', pathPrefix: 'recipes' })
    const imageId = await seedRecipeImage({ recipeId: a, blobUrl: url }) // cria a imagem, aponta A
    await getDb().update(recipe).set({ imageId }).where(eq(recipe.id, b)) // B compartilha a MESMA imagem

    // Apaga A: a imagem SOBREVIVE (B ainda referencia) — nada de blob/linha apagados.
    expect((await del(a, headers)).status).toBe(204)
    expect(await imageExists(imageId)).toBe(true)
    expect(store.blobs.has(url)).toBe(true)

    // Apaga B (última referência): agora reapa a recipe_image + o blob.
    expect((await del(b, headers)).status).toBe(204)
    expect(await imageExists(imageId)).toBe(false)
    expect(store.blobs.has(url)).toBe(false)
  })
})
