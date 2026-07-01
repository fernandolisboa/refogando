import { describe, it, expect } from 'vitest'
import { getDb } from '@/server/deps'
import { loadPublicRecipeBySlug } from '@/server/recipe/load'
import { buildRecipeSeoInputFromRows, loadRecipeSlugMap } from '@/server/recipe/seo'
import { buildRecipeMetadata, buildRecipeJsonLd } from '@/domain/recipe-seo'
import { seedRecipe, seedTranslation, seedRecipeImage, seedReview } from '../helpers/recipes'
import { seedUser } from '../helpers/users'
import { loadRecipeReviews } from '@/server/recipe/review'
import { vocabularyTerm } from '@/db/schema'
import { COZINHA_SEED } from '@/domain/vocabulary-term'

/** Conjunto ATIVO injetado no builder PURO (#319): as 15 cozinhas semeadas. */
const ACTIVE = new Set(COZINHA_SEED.map((t) => t.slug))

const BRAND_OG = `${'https://refogando.com'}/opengraph-image.png`

/** Extrai a URL da PRIMEIRA og:image de um objeto Metadata (a forma varia: array/objeto/string). */
function firstOgImageUrl(meta: ReturnType<typeof buildRecipeMetadata>): unknown {
  const images = meta.openGraph?.images
  const first = Array.isArray(images) ? images[0] : images
  return typeof first === 'object' && first != null && 'url' in first ? first.url : first
}

/**
 * Borda de SEO do detalhe (#232/#233/#234) contra Postgres real (projeto "node"). Cobre o que o
 * teste puro não pode: o mapa de slugs POR LOCALE lido do DB (governa o hreflang) e a montagem do
 * `RecipeSeoInput` a partir das linhas carregadas + o gate de elegibilidade. Os builders puros já
 * são exercitados em `test/domain/recipe-seo.test.ts`; aqui validamos o I/O que os alimenta.
 */

const BASE = 'https://refogando.com'
const db = () => getDb()

describe('loadRecipeSlugMap — slugs POR locale (governa o hreflang)', () => {
  it('só inclui locales com slug NÃO-NULL (acervo só-pt ⇒ só pt-BR)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pão Caseiro',
      provenance: 'escrita_por_pessoa',
      slug: 'pao-caseiro',
    })
    // en-US existe MAS sem slug (NULL no backfill) ⇒ NÃO deve entrar no mapa.
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Homemade Bread',
      provenance: 'automatica_nao_revisada',
      slug: null,
    })

    const map = await loadRecipeSlugMap(db(), recipeId)
    expect(map['pt-BR']).toBe('pao-caseiro')
    expect(map['en-US']).toBeUndefined()
  })

  it('inclui ambos quando ambos têm slug (hreflang bilíngue)', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada',
      provenance: 'escrita_por_pessoa',
      slug: 'feijoada-seo',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Stew',
      provenance: 'automatica_revisada',
      slug: 'stew-seo',
    })

    const map = await loadRecipeSlugMap(db(), recipeId)
    expect(map['pt-BR']).toBe('feijoada-seo')
    expect(map['en-US']).toBe('stew-seo')
  })
})

describe('buildRecipeSeoInputFromRows — monta o RecipeSeoInput da Receita pública', () => {
  it('Receita pública pt-BR ⇒ metadados index/follow + canonical do slug pt-BR', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo de Cenoura',
      descricao: 'Bolo fofinho de cenoura.',
      passos: ['Bata.', 'Asse.'],
      provenance: 'escrita_por_pessoa',
      slug: 'bolo-de-cenoura-seo',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'bolo-de-cenoura-seo', 'pt-BR')
    expect(rows).not.toBeNull()
    const slugMap = await loadRecipeSlugMap(db(), recipeId)
    const input = buildRecipeSeoInputFromRows({
      rows: rows!,
      locale: 'pt-BR',
      baseUrl: BASE,
      slugMap,
      eligible: true,
      activeCozinhas: ACTIVE,
    })

    const meta = buildRecipeMetadata(input)
    expect(meta.alternates?.canonical).toBe(`${BASE}/pt-BR/recipes/bolo-de-cenoura-seo`)
    const robots = meta.robots
    const r = typeof robots === 'object' && robots != null ? robots : {}
    expect(r.index).toBe(true)
    expect(meta.openGraph?.title).toBe('Bolo de Cenoura')

    const ld = buildRecipeJsonLd(input)
    expect(ld['@type']).toBe('Recipe')
    expect(ld.recipeIngredient).toBeUndefined() // sem ingredientes semeados
    expect(ld.recipeInstructions).toEqual([
      { '@type': 'HowToStep', text: 'Bata.' },
      { '@type': 'HowToStep', text: 'Asse.' },
    ])
    // Sem `rating` passado (nenhuma avaliação semeada) ⇒ SEM aggregateRating (#367).
    expect('aggregateRating' in ld).toBe(false)
  })

  it('#367: N avaliações não-moderadas ⇒ aggregateRating (média CRUA + contagem REAL); a MODERADA não conta', async () => {
    // Prova ponta-a-ponta que o agregado que alimenta o JSON-LD vem de `loadRecipeReviews` (cookie-
    // free, filtra `moderated_at IS NULL` + autor vivo) e que o builder emite exatamente esse número
    // (média crua, nunca Bayesiano). A avaliação moderada (removida pelo Curador) NÃO entra na média.
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bem Avaliada',
      provenance: 'escrita_por_pessoa',
      slug: 'bem-avaliada-seo',
    })
    const curatorId = await seedUser({
      email: `seo-rate-cur-${crypto.randomUUID()}@ex.com`,
      role: 'curador',
    })
    const u1 = await seedUser({ email: `seo-rate-1-${crypto.randomUUID()}@ex.com` })
    const u2 = await seedUser({ email: `seo-rate-2-${crypto.randomUUID()}@ex.com` })
    const u3 = await seedUser({ email: `seo-rate-3-${crypto.randomUUID()}@ex.com` })
    await seedReview({ userId: u1, recipeId, rating: 5 })
    await seedReview({ userId: u2, recipeId, rating: 4 })
    // Moderada pelo Curador — some do agregado (moderated_at NOT NULL filtrado).
    await seedReview({ userId: u3, recipeId, rating: 1, moderated: { curatorId } })

    // O MESMO loader cookie-free que o caminho público usa (sem query nova no builder).
    const reviews = await loadRecipeReviews(db(), { id: recipeId })
    expect(reviews).not.toBeNull()
    // média crua = (5+4)/2 = 4.5, contagem 2 (a moderada NÃO conta).
    expect(reviews!.count).toBe(2)
    expect(reviews!.average).toBe(4.5)

    const rows = await loadPublicRecipeBySlug(db(), 'bem-avaliada-seo', 'pt-BR')
    const slugMap = await loadRecipeSlugMap(db(), recipeId)
    const input = buildRecipeSeoInputFromRows({
      rows: rows!,
      locale: 'pt-BR',
      baseUrl: BASE,
      slugMap,
      eligible: true,
      activeCozinhas: ACTIVE,
      rating: { average: reviews!.average, count: reviews!.count },
    })
    const ld = buildRecipeJsonLd(input)
    expect(ld.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      ratingCount: 2,
      reviewCount: 2,
    })
  })

  it('mapeia recipeYield/recipeCuisine/recipeCategory/suitableForDiet/datePublished da linha (ADR-0020 dec.7)', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      cozinha: 'brasileira',
      categoria: 'prato_principal',
      restricoes: ['sem_gluten', 'vegano', 'sem_acucar'], // sem_acucar NÃO mapeia ⇒ omitida
      porcoes: 6,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Feijoada Vegana',
      provenance: 'escrita_por_pessoa',
      slug: 'feijoada-vegana-seo',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'feijoada-vegana-seo', 'pt-BR')
    const slugMap = await loadRecipeSlugMap(db(), recipeId)
    const input = buildRecipeSeoInputFromRows({
      rows: rows!,
      locale: 'pt-BR',
      baseUrl: BASE,
      slugMap,
      eligible: true,
      activeCozinhas: ACTIVE,
    })
    const ld = buildRecipeJsonLd(input)
    expect(ld.recipeYield).toBe('6')
    expect(ld.recipeCuisine).toBe('brasileira')
    expect(ld.recipeCategory).toBe('prato_principal')
    // só os tokens com RestrictedDiet válido; sem_acucar (lossy) omitido.
    expect(ld.suitableForDiet).toEqual([
      'https://schema.org/GlutenFreeDiet',
      'https://schema.org/VeganDiet',
    ])
    // datePublished = createdAt (ISO 8601 do banco) — só conferimos que é uma data válida não-vazia.
    expect(ld.datePublished).toBeTruthy()
    expect(Number.isNaN(Date.parse(ld.datePublished!))).toBe(false)
  })

  it('#319 CONTENÇÃO: cozinha SUGGESTED ⇒ recipeCuisine ausente E o slug cru NÃO aparece no JSON-LD', async () => {
    // O termo `suggested` (fora do conjunto ATIVO) precisa existir p/ a FK de recipe.cozinha.
    await getDb()
      .insert(vocabularyTerm)
      .values({ kind: 'cozinha', slug: 'georgiana', status: 'suggested' })
      .onConflictDoNothing({ target: vocabularyTerm.slug })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      cozinha: 'georgiana', // pendente — NÃO está em ACTIVE
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Khachapuri',
      provenance: 'escrita_por_pessoa',
      slug: 'khachapuri-seo',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'khachapuri-seo', 'pt-BR')
    const slugMap = await loadRecipeSlugMap(db(), recipeId)
    const input = buildRecipeSeoInputFromRows({
      rows: rows!,
      locale: 'pt-BR',
      baseUrl: BASE,
      slugMap,
      eligible: true,
      activeCozinhas: ACTIVE, // georgiana AUSENTE do set ativo
    })
    expect(input.cozinha).toBeNull() // gate ACTIVE-only zerou
    const ld = buildRecipeJsonLd(input)
    expect(ld.recipeCuisine).toBeUndefined()
    // O slug cru não vaza em NENHUM lugar do grafo serializado (contenção total).
    expect(JSON.stringify(ld)).not.toMatch(/georgiana/i)
  })

  it('imagem da receita ⇒ og:image + ld.image = a foto (URL absoluta), sem selo de IA no OG', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Com Foto',
      provenance: 'escrita_por_pessoa',
      slug: 'com-foto-seo',
    })
    await seedRecipeImage({
      recipeId,
      blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/foto.webp',
      provenance: 'ai_generated',
    })

    const rows = await loadPublicRecipeBySlug(db(), 'com-foto-seo', 'pt-BR')
    const slugMap = await loadRecipeSlugMap(db(), recipeId)
    const input = buildRecipeSeoInputFromRows({
      rows: rows!,
      locale: 'pt-BR',
      baseUrl: BASE,
      slugMap,
      eligible: true,
      activeCozinhas: ACTIVE,
    })
    const meta = buildRecipeMetadata(input)
    const images = meta.openGraph?.images
    const first = Array.isArray(images) ? images[0] : images
    const got = typeof first === 'object' && first != null && 'url' in first ? first.url : first
    expect(got).toBe('https://abc.public.blob.vercel-storage.com/recipes/foto.webp')
    // OG NÃO carrega selo de IA mesmo sendo ai_generated.
    expect(JSON.stringify(meta)).not.toMatch(/gerada por IA|✨/i)

    const ld = buildRecipeJsonLd(input)
    expect(ld.image).toBe('https://abc.public.blob.vercel-storage.com/recipes/foto.webp')
  })

  it('imagem MODERADA (#133) NÃO vaza no OG/JSON-LD — og:image cai no card de marca e ld.image é undefined', async () => {
    // Prova que a regra de moderação de imagem (#133) é HERDADA pela borda de SEO: o input é montado
    // por `buildRecipeSeoInputFromRows`, que resolve a view ANÔNIMA (sem viewerId) ⇒ a imagem moderada
    // some da view pública (recipe-read), então nunca chega ao card social nem ao grafo. Sem este
    // gate herdado, uma foto removida por abuso continuaria aparecendo pro crawler/social.
    const curatorId = await seedUser({ email: `seo-mod-curator-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Com Foto Moderada',
      provenance: 'escrita_por_pessoa',
      slug: 'com-foto-moderada-seo',
    })
    await seedRecipeImage({
      recipeId,
      blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/moderada.webp',
      provenance: 'ai_generated',
      moderated: { curatorId },
    })

    const rows = await loadPublicRecipeBySlug(db(), 'com-foto-moderada-seo', 'pt-BR')
    expect(rows).not.toBeNull()
    // A linha CARREGA o blob (o loader não filtra por moderação — o Owner ainda vê a própria), mas
    // marca `imageModerated` ⇒ a view anônima esconde a imagem. Confirma o cenário (não vacuamente).
    expect(rows!.imageUrl).toBe('https://abc.public.blob.vercel-storage.com/recipes/moderada.webp')
    expect(rows!.imageModerated).toBe(true)

    const slugMap = await loadRecipeSlugMap(db(), recipeId)
    const input = buildRecipeSeoInputFromRows({
      rows: rows!,
      locale: 'pt-BR',
      baseUrl: BASE,
      slugMap,
      eligible: true,
      activeCozinhas: ACTIVE,
    })
    // A imagem moderada NÃO entra no input (a view a escondeu) ⇒ og:image cai no card de marca.
    expect(input.imageUrl).toBeUndefined()
    const meta = buildRecipeMetadata(input)
    expect(String(firstOgImageUrl(meta))).toBe(BRAND_OG)

    // E o JSON-LD não carrega `image` da foto moderada.
    const ld = buildRecipeJsonLd(input)
    expect(ld.image).toBeUndefined()
  })
})
