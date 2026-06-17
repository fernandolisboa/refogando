import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as resolveRoute } from '@/app/api/curate/recipes/[id]/ingredients/[itemId]/resolve/route'
import { GET as searchRoute } from '@/app/api/search/route'
import { getDb, setEmbedder } from '@/server/deps'
import { FakeEmbedder, type Embedder } from '@/server/embedding/embedder'
import { recipeIngredient, recipeTranslation } from '@/db/schema'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedIngredient,
  seedIngredientTranslation,
  seedRecipeIngredient,
  seedEmbedding,
} from '../helpers/recipes'

/**
 * Resolver Item raw → Ingrediente canônico (issue #19, AC2) pela porta MAIS ALTA. Prova
 * que o resolve UPDATE-puro ACENDE a busca cross-locale de #9 AO VIVO (antes ausente,
 * depois presente), sem stale/re-embed.
 */

class CountingEmbedder implements Embedder {
  calls = 0
  private readonly inner = new FakeEmbedder(1536)
  async embed(text: string): Promise<number[]> {
    this.calls++
    return this.inner.embed(text)
  }
}

function withJson(base?: Headers): Headers {
  const h = base ? new Headers(base) : new Headers()
  h.set('content-type', 'application/json')
  return h
}

async function curadorHeaders(): Promise<Headers> {
  const { headers } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
  return headers
}

function resolve(id: string, itemId: string, body: unknown, headers?: Headers): Promise<Response> {
  return resolveRoute(
    new Request(`http://localhost/api/curate/recipes/${id}/ingredients/${itemId}/resolve`, {
      method: 'POST',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id, itemId }) },
  )
}

function searchBody(q: string, locale: string): Promise<{ catalogo: { recipeId: string }[]; comunidade: { recipeId: string }[] }> {
  return searchRoute(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}&locale=${encodeURIComponent(locale)}`)).then(
    (r) => r.json() as Promise<{ catalogo: { recipeId: string }[]; comunidade: { recipeId: string }[] }>,
  )
}

/** Cria: canônico frango (pt/en), receita catálogo en-US com 1 Item raw 'chicken thighs'. */
async function seedScenario(): Promise<{ recipeId: string; itemId: string; frango: string }> {
  const frango = await seedIngredient({ slug: `frango-${crypto.randomUUID()}` })
  await seedIngredientTranslation({ ingredientId: frango, locale: 'pt-BR', nome: 'frango', aliases: ['galinha'] })
  await seedIngredientTranslation({ ingredientId: frango, locale: 'en-US', nome: 'chicken' })
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'en-US', ownerId: null })
  await seedTranslation({ recipeId, locale: 'en-US', titulo: 'Grilled thighs over coals', provenance: 'escrita_por_pessoa' })
  const itemId = await seedRecipeIngredient({ recipeId, ingredientId: null, ordem: 0, rawText: 'chicken thighs' })
  return { recipeId, itemId, frango }
}

describe('POST resolve #19 — AC2 acende busca cross-locale', () => {
  it('matriz de gating', async () => {
    const { recipeId, itemId, frango } = await seedScenario()
    const body = { ingredientId: frango }

    const r401 = await resolve(recipeId, itemId, body)
    expect(r401.status).toBe(401)
    expect(await r401.json()).toEqual({ error: 'nao_autenticado' })

    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com`, role: 'usuario' })
    expect((await resolve(recipeId, itemId, body, u)).status).toBe(403)

    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await resolve(recipeId, itemId, body, c)).status).toBe(200)

    const { headers: a } = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com`, role: 'admin' })
    expect((await resolve(recipeId, itemId, body, a)).status).toBe(200)

    const { headers: d } = await seedDeletedSessionHeaders({ email: `d-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const rDel = await resolve(recipeId, itemId, body, d)
    expect(rDel.status).toBe(401)
    expect(await rDel.json()).toEqual({ error: 'conta_desativada' })
  })

  it('guards: id/itemId malformado → 404; receita inexistente → 404; item inexistente → 404; ingredientId inválido → 404', async () => {
    const headers = await curadorHeaders()
    const { recipeId, itemId, frango } = await seedScenario()

    expect((await resolve('bad', itemId, { ingredientId: frango }, headers)).status).toBe(404)
    expect((await resolve(recipeId, 'bad', { ingredientId: frango }, headers)).status).toBe(404)
    expect((await resolve(crypto.randomUUID(), itemId, { ingredientId: frango }, headers)).status).toBe(404)
    // item inexistente (uuid válido mas não existe)
    expect((await resolve(recipeId, crypto.randomUUID(), { ingredientId: frango }, headers)).status).toBe(404)
    // ingredientId ausente/inválido
    expect((await resolve(recipeId, itemId, {}, headers)).status).toBe(404)
    expect((await resolve(recipeId, itemId, { ingredientId: 'bad' }, headers)).status).toBe(404)
    // ingredientId uuid válido mas inexistente
    expect((await resolve(recipeId, itemId, { ingredientId: crypto.randomUUID() }, headers)).status).toBe(404)
  })

  it('gate origin=catalog: resolver Item de receita de comunidade → 404', async () => {
    const headers = await curadorHeaders()
    const { userId } = await seedSessionHeaders({ email: `o-${crypto.randomUUID()}@ex.com` })
    const frango = await seedIngredient({ slug: `frango-${crypto.randomUUID()}` })
    await seedIngredientTranslation({ ingredientId: frango, locale: 'pt-BR', nome: 'frango' })
    const rid = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: userId })
    await seedTranslation({ recipeId: rid, locale: 'pt-BR', titulo: 'Comunidade', provenance: 'escrita_por_pessoa' })
    const itemId = await seedRecipeIngredient({ recipeId: rid, ingredientId: null, ordem: 0, rawText: 'frango' })

    const res = await resolve(rid, itemId, { ingredientId: frango }, headers)
    expect(res.status).toBe(404)
    const [item] = await getDb().select({ ingredientId: recipeIngredient.ingredientId }).from(recipeIngredient).where(eq(recipeIngredient.id, itemId))
    expect(item.ingredientId).toBeNull() // intacto
  })

  it('item de OUTRA receita → 404 (não pertence)', async () => {
    const headers = await curadorHeaders()
    const { recipeId, frango } = await seedScenario()
    const other = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: other, locale: 'pt-BR', titulo: 'Outra', provenance: 'escrita_por_pessoa' })
    const otherItem = await seedRecipeIngredient({ recipeId: other, ingredientId: null, ordem: 0, rawText: 'x' })

    // tenta resolver otherItem via path da receita recipeId (não pertence)
    const res = await resolve(recipeId, otherItem, { ingredientId: frango }, headers)
    expect(res.status).toBe(404)
  })

  it('AC2: antes ausente → resolve → depois presente; UPDATE puro (zero stale/re-embed)', async () => {
    const spy = new CountingEmbedder()
    setEmbedder(spy)
    const headers = await curadorHeaders()
    const { recipeId, itemId, frango } = await seedScenario()
    await seedEmbedding({ recipeId, locale: 'en-US' })

    // ANTES: 'frango' pt-BR não acha (raw 'chicken thighs', canônico não resolvido).
    const before = await searchBody('frango', 'pt-BR')
    expect([...before.catalogo, ...before.comunidade].some((h) => h.recipeId === recipeId)).toBe(false)

    // RESOLVE — isola a contagem de embed AO REDOR do resolve (a busca embeda a QUERY, o
    // que não é re-embed de tradução; só o resolve em si NÃO pode chamar o embedder).
    const callsBeforeResolve = spy.calls
    const res = await resolve(recipeId, itemId, { ingredientId: frango }, headers)
    expect(res.status).toBe(200)
    expect(spy.calls).toBe(callsBeforeResolve) // resolve = UPDATE puro, ZERO embed
    const [item] = await getDb().select({ ingredientId: recipeIngredient.ingredientId }).from(recipeIngredient).where(eq(recipeIngredient.id, itemId))
    expect(item.ingredientId).toBe(frango)

    // DEPOIS: a busca cross-locale acha pelo canônico resolvido.
    const after = await searchBody('frango', 'pt-BR')
    expect([...after.catalogo, ...after.comunidade].some((h) => h.recipeId === recipeId)).toBe(true)

    // UPDATE puro: nada virou stale.
    const [tr] = await getDb().select({ stale: recipeTranslation.stale }).from(recipeTranslation).where(eq(recipeTranslation.recipeId, recipeId))
    expect(tr.stale).toBe(false)
  })

  it('re-resolve troca o vínculo (UPDATE puro idempotente)', async () => {
    const headers = await curadorHeaders()
    const { recipeId, itemId, frango } = await seedScenario()
    const alho = await seedIngredient({ slug: `alho-${crypto.randomUUID()}` })
    await seedIngredientTranslation({ ingredientId: alho, locale: 'pt-BR', nome: 'alho' })

    expect((await resolve(recipeId, itemId, { ingredientId: frango }, headers)).status).toBe(200)
    expect((await resolve(recipeId, itemId, { ingredientId: alho }, headers)).status).toBe(200)
    const [item] = await getDb().select({ ingredientId: recipeIngredient.ingredientId }).from(recipeIngredient).where(eq(recipeIngredient.id, itemId))
    expect(item.ingredientId).toBe(alho)
  })
})
