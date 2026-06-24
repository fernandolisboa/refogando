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
import {
  absoluteRecipeDetailUrl,
  recipeHreflangAlternates,
} from '@/domain/recipe-detail-route'
import { type Locale } from '@/i18n/locale'

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
  /** Rendimento (#234, ADR-0020 dec.7) — `porcoes` da Receita → `recipeYield`. Ausente ⇒ omitido. */
  porcoes?: number | null
  /** Tempo total em minutos (#262, ADR-0023 dec.4) — `tempo_total_min` → `totalTime` (ISO 8601).
   *  Ausente ⇒ omitido. NÃO emitimos `prepTime`/`cookTime` (sem split preparo-vs-cozimento honesto). */
  tempoTotalMin?: number | null
  /** Cozinha (#234) — token de faceta → `recipeCuisine`. Ausente ⇒ omitido. */
  cozinha?: string | null
  /** Categoria (#234) — token de faceta → `recipeCategory`. Ausente ⇒ omitido. */
  categoria?: string | null
  /** Restrições (#234) — tokens de faceta → `suitableForDiet` (só os que mapeiam p/ `RestrictedDiet`). */
  restricoes?: ReadonlyArray<string>
  /** Data de criação (#234) — `recipe.createdAt` → `datePublished` (ISO 8601). Ausente ⇒ omitido. */
  datePublished?: string | null
  /**
   * Elegível p/ leitura pública (= indexação, default-open). `false` ⇒ robots `noindex` (caminho do
   * dono/privado/não-elegível). Default `true` (o load público só devolve dados quando elegível).
   */
  eligible?: boolean
  /** Contagem de votos (#16) — IGNORADA de propósito: Voto ≠ nota, nunca vira aggregateRating (#234). */
  voteCount?: number
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
  const canonical = slug ? absoluteRecipeDetailUrl(baseUrl, locale, slug) : baseUrl
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
      languages: recipeHreflangAlternates(baseUrl, input.slugsByLocale),
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

/**
 * Subset de `schema.org/RestrictedDiet` que mapeamos a partir do enum `Restricao` do app. SÓ
 * entram os tokens com correspondência SEGURA no enum do Google — os ambíguos/sem-equivalente
 * (`sem_acucar`, `low_carb`, `sem_oleaginosas`, `sem_frutos_do_mar`) são OMITIDOS (#234, ADR-0020
 * dec.7: nunca emitir structured data inválido — Google trata enum fora-da-lista como erro).
 */
export type RestrictedDiet =
  | 'https://schema.org/GlutenFreeDiet'
  | 'https://schema.org/LowLactoseDiet'
  | 'https://schema.org/VeganDiet'
  | 'https://schema.org/VegetarianDiet'

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
  /** Rendimento ← `porcoes` (string, ex. `'4'`) — schema.org aceita texto. */
  recipeYield?: string
  /** Tempo total (#262) ← `tempoTotalMin` em ISO 8601 (ex. `'PT1H30M'`). SÓ `totalTime` — nunca
   *  `prepTime`/`cookTime` (ADR-0023 dec.4: não modelamos o split preparo-vs-cozimento). */
  totalTime?: string
  /** Cozinha ← `facets.cozinha` (token). */
  recipeCuisine?: string
  /** Categoria ← `facets.categoria` (token). */
  recipeCategory?: string
  /** Dietas ← `restricoes` mapeadas p/ `RestrictedDiet` (só as seguras; lossy ⇒ omitida). */
  suitableForDiet?: RestrictedDiet[]
  /** Data de publicação ← `recipe.createdAt` (ISO 8601). */
  datePublished?: string
}

/**
 * Mapa LOSSLESS `Restricao` → `RestrictedDiet` do schema.org (#234, ADR-0020 dec.7). Só os tokens
 * com equivalência DIRETA e inequívoca no enum do Google. Os demais (`sem_acucar` ≠ DiabeticDiet;
 * `low_carb`/`sem_oleaginosas`/`sem_frutos_do_mar` sem equivalente) são OMITIDOS de propósito: emitir
 * um enum fora da lista do Google é structured data inválido (risco de ação manual). Lossy ⇒ omite.
 */
const RESTRICTED_DIET_BY_RESTRICAO: Record<string, RestrictedDiet> = {
  sem_gluten: 'https://schema.org/GlutenFreeDiet',
  sem_lactose: 'https://schema.org/LowLactoseDiet',
  vegano: 'https://schema.org/VeganDiet',
  vegetariano: 'https://schema.org/VegetarianDiet',
}

/**
 * Minutos → ISO 8601 duration (#262, ADR-0023 dec.4): `90→'PT1H30M'`, `60→'PT1H'`, `5→'PT5M'`,
 * `1→'PT1M'`. Ausente/não-positivo (null/≤0) → `null` (a chave `totalTime` é OMITIDA). Omite o
 * componente zero. PURO/TOTAL — nunca lança (um throw aqui quebraria o build do JSON-LD da página).
 */
export function minutosParaISO8601(minutos: number | null | undefined): string | null {
  if (minutos == null || minutos <= 0) return null
  const horas = Math.floor(minutos / 60)
  const mins = minutos % 60
  let out = 'PT'
  if (horas > 0) out += `${horas}H`
  if (mins > 0) out += `${mins}M`
  return out
}

/**
 * #234 — objeto JSON-LD `schema.org/Recipe` PÚBLICO da Receita. Conteúdo no idioma do locale
 * corrente (name/description/ingredientes/passos vêm já resolvidos). `image` = a foto VISÍVEL (URL
 * absoluta). Proveniência: `author: Person` quando há dono humano; `isBasedOn` (a fonte externa)
 * quando importada da web (`source`) — NUNCA um autor humano inventado pra importada/catálogo.
 *
 * SEM `aggregateRating`/estrelas: `voteCount` é IGNORADO (Voto ≠ nota — não expomos voto como
 * rating, ADR de SEO). `publisher` = a marca (organização editorial).
 *
 * Campos da ADR-0020 dec.7 mapeados quando a view os traz: `recipeYield`←porções, `recipeCuisine`←
 * cozinha, `recipeCategory`←categoria, `datePublished`←createdAt, `suitableForDiet`←restrições (só as
 * que mapeiam p/ `RestrictedDiet` válido — lossy é OMITIDA, nunca enum inválido). Cada chave sai SÓ
 * quando há dado.
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
  if (slug) ld.mainEntityOfPage = absoluteRecipeDetailUrl(baseUrl, locale, slug)
  if (input.imageUrl) ld.image = input.imageUrl
  if (input.ingredients.length > 0) ld.recipeIngredient = [...input.ingredients]
  if (input.steps.length > 0) {
    ld.recipeInstructions = input.steps.map((text) => ({ '@type': 'HowToStep', text }))
  }
  // Campos da ADR-0020 dec.7 mapeados da view (dados JÁ carregados — sem query nova). Cada chave SÓ
  // sai quando há dado (omite chave vazia — "ausente ≠ vazio", espelha as facetas da view).
  if (input.porcoes != null) ld.recipeYield = String(input.porcoes)
  // Tempo total (#262, ADR-0023 dec.4): só `totalTime` (ISO 8601), e só quando há dado. Nunca
  // `prepTime`/`cookTime` (não modelamos o split). `minutosParaISO8601` devolve null se ≤0 ⇒ omite.
  if (input.tempoTotalMin != null) {
    const iso = minutosParaISO8601(input.tempoTotalMin)
    if (iso) ld.totalTime = iso
  }
  if (input.cozinha) ld.recipeCuisine = input.cozinha
  if (input.categoria) ld.recipeCategory = input.categoria
  if (input.datePublished) ld.datePublished = input.datePublished
  // suitableForDiet: SÓ os tokens com mapa LOSSLESS p/ RestrictedDiet (lossy ⇒ omitido — nunca
  // structured data inválido). Vazio após filtrar ⇒ não emite a chave.
  if (input.restricoes && input.restricoes.length > 0) {
    const diets = input.restricoes
      .map((r) => RESTRICTED_DIET_BY_RESTRICAO[r])
      .filter((d): d is RestrictedDiet => d != null)
    if (diets.length > 0) ld.suitableForDiet = diets
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
