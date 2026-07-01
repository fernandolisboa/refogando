/**
 * Borda (casca fina de I/O) que alimenta os builders PUROS de SEO (`@/domain/recipe-seo`) com os
 * dados da Receita pública (#232 OG, #233 canonical/hreflang/robots, #234 JSON-LD). Faz o MÍNIMO
 * de I/O — lê o mapa de slugs por locale — e o resto é shaping puro reusando `resolveRecipeView`
 * (a MESMA leitura localizada do detalhe, ANÔNIMA: sem `viewerId`) pra extrair nome/descrição/
 * ingredientes/passos no locale corrente, já com o gate de imagem por moderação aplicado.
 *
 * NÃO duplica o gate de elegibilidade nem o `recipeDetailPath` (vivem em `@/domain/...`); o
 * `eligible` é repassado pelo caller (o load público só devolve linhas quando elegível).
 */
import { and, isNotNull, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeTranslation } from '@/db/schema'
import type { LoadedRecipeRows } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'
import type { RecipeSeoInput } from '@/domain/recipe-seo'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { formatIngredientLine } from '@/domain/ingredient-line'

/**
 * Mapa `{ locale → slug }` SÓ dos locales que TÊM tradução pública COM slug (slug NÃO-NULL). É o
 * que governa o hreflang (#233): nunca inventamos URL de locale inexistente. Uma query indexada
 * leve (índice parcial `recipe_translation_locale_slug_uq`); só os locales SUPORTADOS entram.
 */
export async function loadRecipeSlugMap(
  db: Database,
  recipeId: string,
): Promise<Partial<Record<Locale, string>>> {
  const rows = await db
    .select({ locale: recipeTranslation.locale, slug: recipeTranslation.slug })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), isNotNull(recipeTranslation.slug)))

  const map: Partial<Record<Locale, string>> = {}
  for (const row of rows) {
    // Só locales SUPORTADOS pela chrome (defensivo — uma linha de locale exótico não entra no mapa).
    const loc = SUPPORTED_LOCALES.find((l) => l === row.locale)
    if (loc && row.slug) map[loc] = row.slug
  }
  return map
}

/**
 * Monta o `RecipeSeoInput` (insumo dos builders puros) a partir das linhas carregadas pelo load
 * PÚBLICO + o mapa de slugs + a `baseUrl` build-safe. Reusa `resolveRecipeView` ANÔNIMO (sem
 * `viewerId`) — a MESMA leitura localizada do detalhe: nome/descrição/passos no locale corrente +
 * imagem já gateada por moderação (`imageUrl` ausente quando moderada). O selo de IA
 * (`imageAiGenerated`) é repassado MAS o builder de OG não o reflete no card (#232).
 */
export function buildRecipeSeoInputFromRows(args: {
  rows: LoadedRecipeRows
  locale: Locale
  baseUrl: string
  slugMap: Partial<Record<Locale, string>>
  eligible: boolean
  // #319 (ADR-0025 Decisão 5): conjunto de slugs de cozinha ATIVOS. Mantém o builder PURO+SÍNCRONO
  // (sem db) — o caller carrega o set uma vez e o injeta. Uma cozinha `suggested`/`deprecated` NÃO
  // está aqui ⇒ `recipeCuisine`/OG saem ausentes (contenção: o termo pendente não vira sinal
  // indexável nem vaza o slug cru, mas o rótulo VISÍVEL do detalhe usa escopo `display` à parte).
  activeCozinhas: Set<string>
  // #367 (ADR-0027 dec.6): agregado de AVALIAÇÃO da MESMA leitura cookie-free do detalhe
  // (`loadRecipeReviews` — já filtra `moderated_at IS NULL` + autor vivo). Vira `rating` no input
  // SÓ com `count ≥ 1` (senão AUSENTE ⇒ o builder puro não emite `aggregateRating`). Média CRUA —
  // NUNCA o Bayesiano (que só ordena o ranking, #368). Ausente ⇒ receita sem avaliações no grafo.
  rating?: { average: number | null; count: number }
}): RecipeSeoInput {
  const { rows, locale, baseUrl, slugMap, eligible, activeCozinhas, rating } = args
  const m = MESSAGES[locale]

  // Leitura localizada ANÔNIMA: o mesmo motor puro do detalhe resolve nome/corpo/imagem/autoria/
  // fonte no locale corrente, com o gate de imagem por moderação. Sem viewerId ⇒ vista pública.
  const view = resolveRecipeView({
    recipe: rows.recipe,
    translations: rows.translations,
    ingredients: rows.ingredients,
    tags: rows.tags,
    requestLocale: locale,
    ...(rows.author ? { author: rows.author } : {}),
    ...(rows.imageUrl ? { imageUrl: rows.imageUrl } : {}),
    ...(rows.imageAiGenerated ? { imageAiGenerated: rows.imageAiGenerated } : {}),
    ...(rows.imageModerated ? { imageModerated: rows.imageModerated } : {}),
  })

  const ingredients = [...view.ingredients]
    .sort((a, b) => a.ordem - b.ordem)
    .map((item) => formatIngredientLine(item, m, locale))
    .filter((line) => line !== '')

  return {
    locale,
    baseUrl,
    name: view.name,
    ...(view.body.descricao != null ? { description: view.body.descricao } : {}),
    ingredients,
    steps: view.body.passos ?? [],
    slugsByLocale: slugMap,
    // Imagem VISÍVEL (já gateada por moderação na view) — ausente ⇒ card de marca no OG.
    ...(view.imageUrl != null ? { imageUrl: view.imageUrl } : {}),
    ...(view.imageAiGenerated ? { imageAiGenerated: true } : {}),
    // Autoria humana (vira Person no LD) — view.author é mutuamente exclusiva com source.
    ...(view.author ? { author: view.author } : {}),
    // Atribuição à fonte externa (web_imported) — vira isBasedOn no LD.
    ...(view.source ? { source: view.source } : {}),
    brandName: m.app.name,
    // Campos da ADR-0020 dec.7 pro JSON-LD (#234) — da view/linha JÁ carregadas, sem query nova. O
    // builder PURO omite cada chave quando vazia (porcoes/cozinha/categoria/restricoes) e filtra
    // `restricoes` p/ os tokens com `RestrictedDiet` válido (lossy ⇒ omitido).
    porcoes: view.porcoes,
    // Tempo total (#262, ADR-0023): da view JÁ carregada (sem query nova) → `totalTime` no JSON-LD.
    tempoTotalMin: view.tempoTotalMin,
    // #319: recipeCuisine/OG são ACTIVE-ONLY por design — um slug `suggested` (ou `deprecated`) vira
    // null aqui ⇒ o builder puro omite `recipeCuisine` (recipe-seo.ts) e o slug cru não aparece no
    // grafo/OG. O rótulo VISÍVEL na página de detalhe usa escopo `display` à parte (deprecated ainda
    // renderiza; suggested some via `unknownAsAbsent`) — split deliberado visível-mas-não-indexado
    // (ADR-0025 Dec.5 / ADR-0020). NÃO "consertar" de volta para `view.facets.cozinha` cru.
    cozinha:
      view.facets.cozinha && activeCozinhas.has(view.facets.cozinha) ? view.facets.cozinha : null,
    categoria: view.facets.categoria,
    restricoes: view.facets.restricoes ?? [],
    // `createdAt` é opcional no tipo (vem do select em runtime); ausente ⇒ omite datePublished.
    ...(rows.recipe.createdAt ? { datePublished: rows.recipe.createdAt.toISOString() } : {}),
    eligible,
    // #367: só passa `rating` com ≥1 avaliação (aí `average` nunca é null); o builder emite
    // `aggregateRating` com a média CRUA. Sem avaliações ⇒ chave ausente ⇒ sem markup de rating.
    ...(rating && rating.count >= 1
      ? { rating: { value: rating.average ?? 0, count: rating.count } }
      : {}),
  }
}
