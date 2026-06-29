import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation } from '@/db/schema'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/locale'
import type { SitemapRecipe } from '@/domain/sitemap'
import { communityVisibleCondition } from '@/server/recipe/visibility-filter'

/**
 * Query do sitemap (#235, ADR-0020) — carrega TODAS as Receitas INDEXÁVEIS (Catálogo + comunidade
 * pública) com seus slugs POR locale e um `lastModified`. É a casca de I/O que alimenta o builder
 * PURO `buildSitemapEntries`.
 *
 * O GATE DE INDEXAÇÃO é empurrado pro SQL como um WHERE que casa EXATAMENTE o predicado puro
 * `eligibleForPublicRead` (a fonte única do detalhe/hreflang, #230 decisão 6) — sem divergir da
 * regra:
 *   - comunidade: `owner_id IS NULL` (Catálogo editorial, ADR-0011) OR `visibility = 'public'`,
 *   - não-`playful`: `result_kind <> 'playful'`,
 *   - não-removida: `moderation_removed_at IS NULL`,
 *   - E só conta a tradução que TEM `slug` (NÃO-NULL): sem slug não há URL canônica (espelha o
 *     `isNotNull(slug)` de `loadRecipeSlugMap`).
 *
 * UMA query: junta `recipe` × `recipe_translation` (só linhas com slug NÃO-NULL) e agrupa as
 * traduções por Receita em memória (espelha o padrão de `listPublicRecipesByOwner`). O `lastModified`
 * de cada Receita é o MAIOR `updated_at` entre a espinha e suas traduções daquele conjunto — assim o
 * `<lastmod>` reflete a última edição de conteúdo/tradução, não só da espinha. Receita elegível mas
 * sem slug em locale algum simplesmente não casa o INNER JOIN ⇒ não entra (sem URL canônica).
 *
 * NÃO lê cookie/sessão (o gate é o mesmo do crawler e de qualquer anônimo) e NÃO toca `headers()` —
 * build-safe, como exige o caminho indexável.
 *
 * RISCO de escala: devolve TODAS as Receitas indexáveis numa query. Para o acervo atual (curado) é
 * trivial; se o catálogo crescer ao ponto de o sitemap passar dos limites do protocolo (50k URLs /
 * 50MB), paginar via `sitemap.ts` `generateSitemaps` (sitemap-index) é o próximo passo — fora do
 * escopo desta fatia.
 */
export async function loadSitemapRecipes(db: Database): Promise<
  Array<SitemapRecipe & { recipeId: string }>
> {
  const rows = await db
    .select({
      recipeId: recipe.id,
      locale: recipeTranslation.locale,
      slug: recipeTranslation.slug,
      recipeUpdatedAt: recipe.updatedAt,
      translationUpdatedAt: recipeTranslation.updatedAt,
    })
    .from(recipe)
    .innerJoin(recipeTranslation, eq(recipeTranslation.recipeId, recipe.id))
    .where(
      and(
        // Eixo de comunidade — fonte-única `communityVisibleCondition` (espelha `isCommunityVisible`/
        // `eligibleForPublicRead`): Catálogo (owner NULL) **CURADO** (`approved`, #238/ADR-0026) OU
        // publicada. Usa o single-source (não reimplementa inline) p/ o ramo de curadoria nunca faltar.
        communityVisibleCondition(recipe),
        // Não-`playful` (gate de índice default-open).
        sql`${recipe.resultKind} <> 'playful'`,
        // Não-removida pela moderação.
        isNull(recipe.moderationRemovedAt),
        // Só traduções COM slug — sem slug não há URL canônica.
        isNotNull(recipeTranslation.slug),
      ),
    )

  // Agrupa as traduções (locale → slug) por Receita e computa o lastModified = max(updated_at).
  const byRecipe = new Map<string, SitemapRecipe & { recipeId: string }>()
  for (const row of rows) {
    // Defensivo: só locales SUPORTADOS pela chrome entram (uma linha de locale exótico não vira URL).
    const loc = SUPPORTED_LOCALES.find((l): l is Locale => l === row.locale)
    if (!loc || row.slug == null) continue

    const existing = byRecipe.get(row.recipeId)
    if (existing) {
      existing.slugsByLocale[loc] = row.slug
      if (row.translationUpdatedAt > existing.lastModified) {
        existing.lastModified = row.translationUpdatedAt
      }
    } else {
      const lastModified =
        row.translationUpdatedAt > row.recipeUpdatedAt
          ? row.translationUpdatedAt
          : row.recipeUpdatedAt
      byRecipe.set(row.recipeId, {
        recipeId: row.recipeId,
        slugsByLocale: { [loc]: row.slug },
        lastModified,
      })
    }
  }

  return [...byRecipe.values()]
}
