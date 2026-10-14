import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { appConfig, recipe, recipeImage, recipeTranslation } from '@/db/schema'
import {
  loadRecipeOfTheWeek,
  isCatalogRecipeApproved,
  searchCatalogApprovedRecipes,
  loadCatalogApprovedRecipeTitle,
  RECIPE_OF_WEEK_POPULAR_TAG,
} from '@/server/recipe/recipe-of-week'
import { GET as highlightSearchGET } from '@/app/api/admin/catalog/highlight-search/route'
import { PUT as adminConfigPUT } from '@/app/api/admin/config/route'
import { DEFAULT_POPULARITY_CONFIG } from '@/domain/popularity'
import {
  seedRecipe,
  seedTranslation,
  seedSave,
  seedRemovedFromPool,
  seedRecipeImage,
} from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { cachedEntryCount, revalidatedTags } from '../helpers/next-cache'

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

/** Catálogo aprovado com título pt-BR (e en-US opcional). */
async function seedCatalogRecipe(tituloPt: string, tituloEn?: string): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: tituloPt, provenance: 'escrita_por_pessoa' })
  if (tituloEn) {
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: tituloEn, provenance: 'automatica_revisada' })
  }
  return id
}

let fanSeq = 0
/** `n` saves de usuários distintos (self-save não conta). */
async function giveSaves(recipeId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const userId = await seedUser({ email: `row-cache-fan${++fanSeq}@ex.com` })
    await seedSave({ userId, recipeId })
  }
}

async function adminPut(body: unknown): Promise<Response> {
  const { headers } = await seedSessionHeaders({ email: `row-cache-admin${++fanSeq}@ex.com`, role: 'admin' })
  return adminConfigPUT(
    new Request('http://localhost/api/admin/config', { method: 'PUT', headers, body: JSON.stringify(body) }),
  )
}

/**
 * Cache de 10 min do vencedor por Popularidade (achado F, auditoria de performance 2026-10-13). O
 * `next/cache` é o dublê de test/helpers/next-cache.ts (registrado em test/setup.ts, zerado por teste).
 */
describe('loadRecipeOfTheWeek — cache do vencedor por Popularidade (achado F)', () => {
  it('o vencedor fica em cache: popularidade nova só aparece depois da invalidação pelo admin', async () => {
    const a = await seedCatalogRecipe('Bolo A')
    const b = await seedCatalogRecipe('Bolo B')
    await giveSaves(a, 2)

    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(a)
    expect(cachedEntryCount()).toBe(1)

    // B passa A em popularidade: o slot segue em A enquanto o vencedor estiver em cache.
    await giveSaves(b, 5)
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(a)

    // Salvar os pesos de popularidade expira o vencedor na hora.
    expect((await adminPut({ popularity: DEFAULT_POPULARITY_CONFIG })).status).toBe(200)
    expect(revalidatedTags()).toEqual([{ tag: RECIPE_OF_WEEK_POPULAR_TAG, profile: { expire: 0 } }])
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(b)
  })

  it('salvar a Receita da semana invalida; salvar outro eixo da config não', async () => {
    await seedCatalogRecipe('Bolo único')
    expect((await adminPut({ catalogDisclosure: { enabled: true, text: 'Aviso' } })).status).toBe(200)
    expect(revalidatedTags()).toEqual([])
    expect((await adminPut({ recipeOfWeek: { recipeId: null } })).status).toBe(200)
    expect(revalidatedTags()).toEqual([{ tag: RECIPE_OF_WEEK_POPULAR_TAG, profile: { expire: 0 } }])
  })

  it('a escolha do Curador aparece na hora, mesmo com um vencedor em cache', async () => {
    const popular = await seedCatalogRecipe('Bolo popular')
    const escolhida = await seedCatalogRecipe('Escolhida pela curadoria')
    await giveSaves(popular, 3)
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(popular)

    expect((await adminPut({ recipeOfWeek: { recipeId: escolhida } })).status).toBe(200)
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(escolhida)
  })

  it('o vencedor em cache removido pela moderação some na hora (re-checagem por PK)', async () => {
    const a = await seedCatalogRecipe('Bolo A')
    const b = await seedCatalogRecipe('Bolo B')
    await giveSaves(a, 3)
    await giveSaves(b, 1)
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(a)

    const curatorId = await seedUser({ email: 'row-cache-curator@ex.com' })
    await seedRemovedFromPool({ recipeId: a, curatorId })
    // Sem invalidação: o id guardado (A) não passa no gate e o vencedor é recalculado ao vivo.
    expect(revalidatedTags()).toEqual([])
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(b)
  })

  it('o vencedor em cache que sai de approved ou é apagado some na hora', async () => {
    const a = await seedCatalogRecipe('Bolo A')
    const b = await seedCatalogRecipe('Bolo B')
    const c = await seedCatalogRecipe('Bolo C')
    await giveSaves(a, 4)
    await giveSaves(b, 2)
    await giveSaves(c, 1)
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(a)

    await db().update(recipe).set({ curationStatus: 'rejected' }).where(eq(recipe.id, a))
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(b)

    await db().delete(recipe).where(eq(recipe.id, b))
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(c)
  })

  it('uma entrada só para os dois idiomas; título e imagem relidos a cada request', async () => {
    const a = await seedCatalogRecipe('Bolo de fubá', 'Cornmeal cake')
    const curatorId = await seedUser({ email: 'row-cache-img@ex.com' })
    const imageId = await seedRecipeImage({ recipeId: a, provenance: 'user_photo' })

    const pt = await loadRecipeOfTheWeek(db(), 'pt-BR')
    const en = await loadRecipeOfTheWeek(db(), 'en-US')
    expect(pt?.recipeId).toBe(a)
    expect(en?.recipeId).toBe(a)
    expect(pt?.displayedTitle).toBe('Bolo de fubá')
    expect(en?.displayedTitle).toContain('Cornmeal cake')
    expect(pt?.imageUrl).toBeDefined()
    expect(cachedEntryCount()).toBe(1) // o vencedor não depende do idioma

    // Edição de título e moderação da imagem depois do cache aparecem já no próximo request.
    await db()
      .update(recipeTranslation)
      .set({ titulo: 'Bolo de fubá cremoso' })
      .where(and(eq(recipeTranslation.recipeId, a), eq(recipeTranslation.locale, 'pt-BR')))
    await db()
      .update(recipeImage)
      .set({ moderatedAt: new Date(), moderatedReason: 'teste', moderatedBy: curatorId })
      .where(eq(recipeImage.id, imageId))
    const depois = await loadRecipeOfTheWeek(db(), 'pt-BR')
    expect(depois?.displayedTitle).toBe('Bolo de fubá cremoso')
    expect(depois?.imageUrl).toBeUndefined()
  })

  it('catálogo vazio quando o cache foi preenchido: a primeira receita aprovada aparece sem esperar', async () => {
    expect(await loadRecipeOfTheWeek(db(), 'pt-BR')).toBeNull()
    const a = await seedCatalogRecipe('Primeira do catálogo')
    expect((await loadRecipeOfTheWeek(db(), 'pt-BR'))?.recipeId).toBe(a)
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

  it('"%", "_" e "\\" digitados casam literalmente (antes eram curinga do ILIKE)', async () => {
    const integral = await seedCatalogRecipe('Bolo 100% integral')
    await seedCatalogRecipe('Bolo 1000 folhas') // '%100%%' antigo casava este também
    const pao = await seedCatalogRecipe('Pão de queijo') // '%p_o%' antigo casava 'pão'
    const sublinhado = await seedCatalogRecipe('Receita p_o teste')
    await seedCatalogRecipe('Receita ab teste') // '%a\\b%' antigo = '%ab%'
    const barra = await seedCatalogRecipe('Receita a\\b teste')

    const ids = async (q: string) =>
      (await searchCatalogApprovedRecipes(db(), { q, requestLocale: 'pt-BR' })).map((h) => h.recipeId)
    expect(await ids('100%')).toEqual([integral])
    expect(await ids('p_o')).toEqual([sublinhado])
    expect(await ids('a\\b')).toEqual([barra])
    // Controle positivo: sem curinga a busca segue igual.
    expect(await ids('queijo')).toEqual([pao])
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
