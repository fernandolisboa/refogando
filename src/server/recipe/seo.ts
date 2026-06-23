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
import { resolveRecipeView, type IngredientView } from '@/domain/recipe-read'
import type { RecipeSeoInput } from '@/domain/recipe-seo'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/locale'
import { MESSAGES, type Messages } from '@/i18n/messages'
import { isUnidade } from '@/domain/vocabulary'

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
 * Linha legível de UM ingrediente para o `recipeIngredient` do JSON-LD: `qtd unidade — texto`.
 * Espelha `formatIngredient` do `RecipeDetailView` (mesma substância exibida ao leitor); a unidade
 * vira rótulo localizado via `MESSAGES[locale]`. Item totalmente vazio ⇒ string vazia (descartada).
 */
function formatIngredientLine(item: IngredientView, m: Messages): string {
  const quantidade =
    item.quantidade != null && item.quantidade !== '' ? formatQuantidade(item.quantidade) : null
  const unidade =
    item.unidade != null && item.unidade !== '' ? formatUnidade(item.unidade, m) : null
  const medida = [quantidade, unidade].filter((p) => p != null && p !== '').join(' ')
  if (medida && item.rawText) return `${medida} — ${item.rawText}`
  return medida || item.rawText || ''
}

/** Tira zeros à direita do `numeric(10,3)` (`'2.500'`→`'2.5'`); não-número cai no cru. */
function formatQuantidade(quantidade: string): string {
  const n = Number(quantidade)
  return Number.isFinite(n) ? String(n) : quantidade
}

/** Rótulo localizado da unidade do enum (token machine-readable → label); fora do enum sai cru. */
function formatUnidade(unidade: string, m: Messages): string {
  return isUnidade(unidade) ? m.unidadeLabel[unidade] : unidade
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
}): RecipeSeoInput {
  const { rows, locale, baseUrl, slugMap, eligible } = args
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
    .map((item) => formatIngredientLine(item, m))
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
    eligible,
    ...(view.voteCount != null ? { voteCount: view.voteCount } : {}),
  }
}
