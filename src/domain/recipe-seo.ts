/**
 * Builders PUROS de SEO da página de detalhe da Receita (#232 OG, #233 canonical/hreflang/robots,
 * #234 JSON-LD) — sem DB, sem React, sem `next/*`. Recebem os dados JÁ carregados/resolvidos
 * (nome, descrição, ingredientes, passos, slugs por locale, imagem, proveniência) MAIS a `baseUrl`
 * BUILD-SAFE (env-only, NUNCA derivada de `headers()` — senão a página de detalhe pública vira
 * dinâmica e perde a cacheabilidade do caminho indexável, ADR-0020), e devolvem:
 *  - `buildRecipeMetadata` → o objeto `Metadata` do Next (metadataBase + openGraph + twitter +
 *    alternates {canonical, languages, x-default} + robots).
 *  - `buildRecipeJsonLd` → o objeto JSON-LD `schema.org/Recipe`.
 *  - `serializeJsonLd` → a STRING segura do JSON-LD pro `<script type="application/ld+json">`
 *    (escapa `<` p/ um `</script>` no conteúdo não fechar a tag — XSS).
 *
 * O `generateMetadata` e o componente da página são cascas finas: carregam o I/O (DB direto via
 * `loadPublicRecipeBySlug`, gate de elegibilidade) e chamam estes builders. Espelha o padrão do
 * repo "kernel puro + casca fina de I/O" (recipe-detail-route.ts puro ↔ recipe/load.ts borda).
 *
 * REUSA `recipeDetailPath` (= `/{locale}/recipes/{slug}`) e `SUPPORTED_LOCALES`/`DEFAULT_LOCALE`
 * — NÃO duplica nem hardcoda. O gate de elegibilidade (`eligibleForPublicRead`) NÃO é reavaliado
 * aqui: o caller passa `eligible` (já calculado/garantido pelo load público), e o builder só
 * traduz isso em `robots` index/follow vs noindex.
 */
import type { Metadata } from 'next'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/i18n/locale'

/** Asset estável do card de MARCA (#232) — fallback de OG quando a Receita não tem foto. */
const BRAND_OG_IMAGE_PATH = '/opengraph-image.png'

/**
 * Insumo dos builders — dados JÁ resolvidos pela borda (sem I/O aqui). `name`/`description`/
 * `ingredients`/`steps` vêm da leitura localizada (`resolveRecipeView`) no locale CORRENTE;
 * `slugsByLocale` traz o slug PÚBLICO de cada locale que TEM tradução com slug (a chave só existe
 * quando há slug — é o que governa o hreflang). `imageUrl` é a foto VISÍVEL (já gateada por
 * moderação na view). `eligible` repassa o gate de leitura pública (= indexação).
 */
export type RecipeSeoInput = {
  /** Locale CORRENTE da página (governa canonical, og:url, inLanguage e a língua do conteúdo). */
  locale: Locale
  /** Base URL absoluta BUILD-SAFE (env-only, sem `headers()`). Ex.: `https://refogando.com`. */
  baseUrl: string
  /** Nome resolvido no locale corrente (de `resolveRecipeView`). */
  name: string
  /** Descrição resolvida no locale corrente (pode faltar ⇒ cai num resumo do conteúdo/marca). */
  description?: string | null
  /** Linhas de ingrediente já renderizadas (texto), na ordem da receita. */
  ingredients: ReadonlyArray<string>
  /** Passos do modo de preparo no locale corrente (vira `HowToStep`). */
  steps: ReadonlyArray<string>
  /**
   * Slug PÚBLICO por locale — SÓ entram os locales que TÊM tradução pública COM slug. Governa o
   * hreflang (#233): NÃO inventamos URL de locale que não existe. O locale corrente DEVE estar
   * presente (a página só renderiza por slug). Ex. acervo só-pt: `{ 'pt-BR': 'bolo' }`.
   */
  slugsByLocale: Partial<Record<Locale, string>>
  /** Foto VISÍVEL da receita (URL absoluta do blob). Ausente ⇒ card de marca no OG, sem image no LD. */
  imageUrl?: string
  /** Imagem é gerada por IA? NÃO reflete no OG (#232 — a imagem é vitrine no card); só dado de in-app. */
  imageAiGenerated?: boolean
  /** Autoria humana (#129) — vira `author: Person` no JSON-LD. Ausente p/ Catálogo/importada. */
  author?: { name: string; handle: string }
  /** Atribuição à FONTE externa (#169, web_imported) — vira `isBasedOn` no JSON-LD. */
  source?: { url: string; name?: string }
  /** Nome da marca p/ rótulos do OG (publisher), do catálogo de mensagens do locale. */
  brandName: string
  /**
   * Elegível p/ leitura pública (= indexação, default-open). `false` ⇒ robots `noindex` (caminho do
   * dono/privado/não-elegível). Default `true` (o load público só devolve dados quando elegível).
   */
  eligible?: boolean
  /** Contagem de votos (#16) — IGNORADA de propósito: Voto ≠ nota, nunca vira aggregateRating (#234). */
  voteCount?: number
}

/** URL absoluta canônica do detalhe `<base>/{locale}/recipes/{slug}`. */
function absoluteDetailUrl(baseUrl: string, locale: string, slug: string): string {
  return `${baseUrl}${recipeDetailPath(locale, slug)}`
}

/**
 * Mapa hreflang `{ locale → url, x-default → url(DEFAULT_LOCALE) }` SÓ dos locales presentes em
 * `slugsByLocale` (= têm tradução pública com slug). x-default aponta pro DEFAULT_LOCALE quando ele
 * existe; senão pro primeiro locale suportado presente (degrade gracioso — não deixa o x-default
 * apontar pra um locale inexistente).
 */
function buildLanguageAlternates(
  baseUrl: string,
  slugsByLocale: Partial<Record<Locale, string>>,
): Record<string, string> {
  const langs: Record<string, string> = {}
  for (const loc of SUPPORTED_LOCALES) {
    const slug = slugsByLocale[loc]
    if (slug) langs[loc] = absoluteDetailUrl(baseUrl, loc, slug)
  }
  // x-default: prioriza o DEFAULT_LOCALE; se ele não tiver slug, usa o primeiro presente.
  const defaultSlug =
    slugsByLocale[DEFAULT_LOCALE] ?? SUPPORTED_LOCALES.map((l) => slugsByLocale[l]).find(Boolean)
  const defaultLocaleForX = slugsByLocale[DEFAULT_LOCALE]
    ? DEFAULT_LOCALE
    : SUPPORTED_LOCALES.find((l) => slugsByLocale[l])
  if (defaultSlug && defaultLocaleForX) {
    langs['x-default'] = absoluteDetailUrl(baseUrl, defaultLocaleForX, defaultSlug)
  }
  return langs
}

/**
 * #232 + #233 — objeto `Metadata` do Next pra UMA Receita pública. metadataBase = baseUrl
 * build-safe; openGraph/twitter com title/description do conteúdo do locale + image híbrida (foto
 * da receita OU card de marca); alternates {canonical, languages+x-default}; robots index/follow vs
 * noindex conforme `eligible`. NUNCA reflete o selo de IA no card (#232).
 */
export function buildRecipeMetadata(input: RecipeSeoInput): Metadata {
  const { locale, baseUrl, name, brandName } = input
  const slug = input.slugsByLocale[locale]
  // O caller garante que o locale corrente tem slug (a página só renderiza por slug público).
  const canonical = slug ? absoluteDetailUrl(baseUrl, locale, slug) : baseUrl
  const description =
    input.description && input.description.trim() !== '' ? input.description : undefined

  // Imagem híbrida (#232): foto da receita quando existe (URL ABSOLUTA do blob); senão o card de
  // marca (asset estável sob a baseUrl). SEM selo de IA mesmo em ai_generated — a imagem é vitrine.
  const ogImageUrl = input.imageUrl ?? `${baseUrl}${BRAND_OG_IMAGE_PATH}`

  const eligible = input.eligible !== false

  return {
    metadataBase: new URL(baseUrl),
    title: name,
    ...(description ? { description } : {}),
    alternates: {
      canonical,
      languages: buildLanguageAlternates(baseUrl, input.slugsByLocale),
    },
    openGraph: {
      type: 'article',
      title: name,
      ...(description ? { description } : {}),
      url: canonical,
      siteName: brandName,
      locale,
      images: [{ url: ogImageUrl, alt: name }],
    },
    twitter: {
      card: 'summary_large_image',
      title: name,
      ...(description ? { description } : {}),
      images: [ogImageUrl],
    },
    // Indexação DEFAULT-OPEN (#233): elegível ⇒ index/follow; não-elegível ⇒ noindex (caminho do
    // dono/privado). SEM gate humano — tradução automática também indexa (só sinalizada na UI).
    robots: eligible
      ? { index: true, follow: true }
      : { index: false, follow: false },
  }
}

/** Forma do objeto JSON-LD `schema.org/Recipe` que emitimos (subset tipado — sem `aggregateRating`). */
export type RecipeJsonLd = {
  '@context': 'https://schema.org'
  '@type': 'Recipe'
  name: string
  description?: string
  inLanguage: string
  image?: string
  recipeIngredient?: string[]
  recipeInstructions?: Array<{ '@type': 'HowToStep'; text: string }>
  author?: { '@type': 'Person'; name: string }
  isBasedOn?: string
  publisher?: { '@type': 'Organization'; name: string }
  /** URL canônica da Receita — `mainEntityOfPage`. */
  mainEntityOfPage?: string
}

/**
 * #234 — objeto JSON-LD `schema.org/Recipe` PÚBLICO da Receita. Conteúdo no idioma do locale
 * corrente (name/description/ingredientes/passos vêm já resolvidos). `image` = a foto VISÍVEL (URL
 * absoluta). Proveniência: `author: Person` quando há dono humano; `isBasedOn` (a fonte externa)
 * quando importada da web (`source`) — NUNCA um autor humano inventado pra importada/catálogo.
 *
 * SEM `aggregateRating`/estrelas: `voteCount` é IGNORADO (Voto ≠ nota — não expomos voto como
 * rating, ADR de SEO). `publisher` = a marca (organização editorial).
 */
export function buildRecipeJsonLd(input: RecipeSeoInput): RecipeJsonLd {
  const { locale, baseUrl, name, brandName } = input
  const slug = input.slugsByLocale[locale]
  const description =
    input.description && input.description.trim() !== '' ? input.description : undefined

  const ld: RecipeJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name,
    inLanguage: locale,
    publisher: { '@type': 'Organization', name: brandName },
  }
  if (description) ld.description = description
  if (slug) ld.mainEntityOfPage = absoluteDetailUrl(baseUrl, locale, slug)
  if (input.imageUrl) ld.image = input.imageUrl
  if (input.ingredients.length > 0) ld.recipeIngredient = [...input.ingredients]
  if (input.steps.length > 0) {
    ld.recipeInstructions = input.steps.map((text) => ({ '@type': 'HowToStep', text }))
  }
  // Proveniência (mutuamente exclusiva, espelha a view): importada ⇒ fonte externa (isBasedOn);
  // senão ⇒ autoria humana (Person) quando há dono. Catálogo sem dono ⇒ nenhum dos dois (só publisher).
  if (input.source) {
    ld.isBasedOn = input.source.url
  } else if (input.author) {
    ld.author = { '@type': 'Person', name: input.author.name }
  }
  return ld
}

/**
 * STRING segura do JSON-LD pro `<script type="application/ld+json">`. Escapa `<` (→ `<`): um
 * `</script>` embutido em texto livre (nome/descrição) fecharia a tag e abriria XSS. Escapar só o
 * `<` mantém o JSON válido e preserva o dado (o parser do navegador lê `<` como `<`).
 */
export function serializeJsonLd(ld: RecipeJsonLd): string {
  return JSON.stringify(ld).replace(/</g, '\\u003c')
}
