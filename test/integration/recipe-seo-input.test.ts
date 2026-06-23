import { describe, it, expect } from 'vitest'
import { getDb } from '@/server/deps'
import { loadPublicRecipeBySlug } from '@/server/recipe/load'
import { buildRecipeSeoInputFromRows, loadRecipeSlugMap } from '@/server/recipe/seo'
import { buildRecipeMetadata, buildRecipeJsonLd } from '@/domain/recipe-seo'
import { seedRecipe, seedTranslation, seedRecipeImage } from '../helpers/recipes'
import { seedUser } from '../helpers/users'

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
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating/i)
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
