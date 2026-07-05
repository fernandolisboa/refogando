import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { appConfig, recipe } from '@/db/schema'
import {
  loadRecipeOfTheWeek,
  isCatalogRecipeApproved,
  searchCatalogApprovedRecipes,
  loadCatalogApprovedRecipeTitle,
} from '@/server/recipe/recipe-of-week'
import { GET as highlightSearchGET } from '@/app/api/admin/catalog/highlight-search/route'
import { seedRecipe, seedTranslation, seedSave, seedRemovedFromPool } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

const db = () => getDb()

async function setRecipeOfWeek(recipeId: string | null): Promise<void> {
  await db()
    .insert(appConfig)
    .values({ id: true, recipeOfWeekConfig: { recipeId } })
    .onConflictDoUpdate({ target: appConfig.id, set: { recipeOfWeekConfig: { recipeId } } })
}

/**
 * "Receita da semana" (#457, ADR-0026) — prova o loader `loadRecipeOfTheWeek` contra Postgres real:
 * escolha do Curador (re-validada), fallback por Popularidade, e a busca do picker do admin.
 */
describe('loadRecipeOfTheWeek (#457)', () => {
  it('catálogo aprovado VAZIO ⇒ null (sem escolha, sem candidato de fallback)', async () => {
    const result = await loadRecipeOfTheWeek(db(), 'pt-BR')
    expect(result).toBeNull()
  })

  it('sem escolha do Curador ⇒ fallback: a receita de MAIOR popularidade do catálogo aprovado', async () => {
    const menosPopular = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: menosPopular, locale: 'pt-BR', titulo: 'Bolo simples', provenance: 'escrita_por_pessoa' })

    const maisPopular = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: maisPopular, locale: 'pt-BR', titulo: 'Bolo famoso', provenance: 'escrita_por_pessoa' })
    // Dá saves ao "maisPopular" (de usuários distintos — self-save não vale) pra garantir score maior.
    const u1 = await seedUser({ email: 'row-fan1@ex.com' })
    const u2 = await seedUser({ email: 'row-fan2@ex.com' })
    const u3 = await seedUser({ email: 'row-fan3@ex.com' })
    await seedSave({ userId: u1, recipeId: maisPopular })
    await seedSave({ userId: u2, recipeId: maisPopular })
    await seedSave({ userId: u3, recipeId: maisPopular })

    const result = await loadRecipeOfTheWeek(db(), 'pt-BR')
    expect(result?.recipeId).toBe(maisPopular)
    expect(result?.displayedTitle).toBe('Bolo famoso')
  })

  it('escolha do Curador (válida) VENCE o fallback de popularidade', async () => {
    const popular = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: popular, locale: 'pt-BR', titulo: 'Bolo popular', provenance: 'escrita_por_pessoa' })
    const u1 = await seedUser({ email: 'row-fan4@ex.com' })
    await seedSave({ userId: u1, recipeId: popular })

    const escolhida = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: escolhida, locale: 'pt-BR', titulo: 'Escolhida pela curadoria', provenance: 'escrita_por_pessoa' })

    await setRecipeOfWeek(escolhida)
    const result = await loadRecipeOfTheWeek(db(), 'pt-BR')
    expect(result?.recipeId).toBe(escolhida)
  })

  it('escolha que DEIXOU de ser catálogo aprovado (rejeitada depois) degrada pro fallback', async () => {
    const escolhidaMasRejeitada = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId: escolhidaMasRejeitada,
      locale: 'pt-BR',
      titulo: 'Foi escolhida mas caiu',
      provenance: 'escrita_por_pessoa',
    })
    await setRecipeOfWeek(escolhidaMasRejeitada)
    // O Curador muda de ideia DEPOIS de escolher: rejeita a receita.
    await db().update(recipe).set({ curationStatus: 'rejected' }).where(eq(recipe.id, escolhidaMasRejeitada))

    const fallback = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: fallback, locale: 'pt-BR', titulo: 'Única aprovada restante', provenance: 'escrita_por_pessoa' })

    const result = await loadRecipeOfTheWeek(db(), 'pt-BR')
    expect(result?.recipeId).toBe(fallback)
    expect(result?.displayedTitle).toBe('Única aprovada restante')
  })

  it('escolha de uma Receita de COMUNIDADE (nunca catálogo) degrada pro fallback', async () => {
    const ownerId = await seedUser({ email: 'row-owner2@ex.com' })
    const comunidade = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    await seedTranslation({ recipeId: comunidade, locale: 'pt-BR', titulo: 'Da comunidade', provenance: 'escrita_por_pessoa' })
    await setRecipeOfWeek(comunidade)

    const fallback = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: fallback, locale: 'pt-BR', titulo: 'Catálogo aprovado', provenance: 'escrita_por_pessoa' })

    const result = await loadRecipeOfTheWeek(db(), 'pt-BR')
    expect(result?.recipeId).toBe(fallback)
  })
})

describe('isCatalogRecipeApproved (#457)', () => {
  it('true para catálogo aprovado; false para pending/comunidade/removida', async () => {
    const approved = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    expect(await isCatalogRecipeApproved(db(), approved)).toBe(true)

    const pending = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })
    expect(await isCatalogRecipeApproved(db(), pending)).toBe(false)

    const ownerId = await seedUser({ email: 'row-owner3@ex.com' })
    const community = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    expect(await isCatalogRecipeApproved(db(), community)).toBe(false)

    const removed = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const curatorId = await seedUser({ email: 'row-curator@ex.com' })
    await seedRemovedFromPool({ recipeId: removed, curatorId })
    expect(await isCatalogRecipeApproved(db(), removed)).toBe(false)
  })
})

describe('searchCatalogApprovedRecipes / loadCatalogApprovedRecipeTitle (#457, picker do admin)', () => {
  it('busca por título restrita ao catálogo aprovado (ignora pending e comunidade)', async () => {
    const alvo = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: alvo, locale: 'pt-BR', titulo: 'Torta de limão siciliano', provenance: 'escrita_por_pessoa' })

    const pending = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })
    await seedTranslation({ recipeId: pending, locale: 'pt-BR', titulo: 'Torta de limão rascunho', provenance: 'escrita_por_pessoa' })

    const ownerId = await seedUser({ email: 'row-owner4@ex.com' })
    const community = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
    await seedTranslation({ recipeId: community, locale: 'pt-BR', titulo: 'Torta de limão da comunidade', provenance: 'escrita_por_pessoa' })

    const hits = await searchCatalogApprovedRecipes(db(), { q: 'limão', requestLocale: 'pt-BR' })
    expect(hits).toEqual([{ recipeId: alvo, titulo: 'Torta de limão siciliano', slug: null }])
  })

  it('q vazio/só-espaço ⇒ [] (não lista o catálogo inteiro)', async () => {
    const alvo = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: alvo, locale: 'pt-BR', titulo: 'Qualquer coisa', provenance: 'escrita_por_pessoa' })
    expect(await searchCatalogApprovedRecipes(db(), { q: '', requestLocale: 'pt-BR' })).toEqual([])
    expect(await searchCatalogApprovedRecipes(db(), { q: '   ', requestLocale: 'pt-BR' })).toEqual([])
  })

  it('loadCatalogApprovedRecipeTitle: null quando o id não é (mais) catálogo aprovado', async () => {
    const rejected = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'rejected' })
    await seedTranslation({ recipeId: rejected, locale: 'pt-BR', titulo: 'Rejeitada', provenance: 'escrita_por_pessoa' })
    expect(await loadCatalogApprovedRecipeTitle(db(), rejected, 'pt-BR')).toBeNull()
  })
})

describe('GET /api/admin/catalog/highlight-search (#457, admin-only)', () => {
  function get(url: string, headers?: Headers): Promise<Response> {
    return highlightSearchGET(new Request(url, { headers }))
  }

  it('Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hs-cur@cfg.test', role: 'curador' })
    const res = await get('http://localhost/api/admin/catalog/highlight-search?q=bolo', headers)
    expect(res.status).toBe(403)
  })

  it('sem q nem id ⇒ 400 parametro_invalido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hs-none@cfg.test', role: 'admin' })
    const res = await get('http://localhost/api/admin/catalog/highlight-search', headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'parametro_invalido' })
  })

  it('?q= devolve hits do catálogo aprovado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hs-q@cfg.test', role: 'admin' })
    const alvo = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: alvo, locale: 'pt-BR', titulo: 'Pudim de leite', provenance: 'escrita_por_pessoa' })
    const res = await get('http://localhost/api/admin/catalog/highlight-search?q=pudim', headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { hits: { recipeId: string; titulo: string }[] }
    expect(body.hits).toEqual([{ recipeId: alvo, titulo: 'Pudim de leite', slug: null }])
  })

  it('?id= com uuid malformado ⇒ { hit: null } sem 500', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hs-badid@cfg.test', role: 'admin' })
    const res = await get('http://localhost/api/admin/catalog/highlight-search?id=nao-e-uuid', headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ hit: null })
  })
})
