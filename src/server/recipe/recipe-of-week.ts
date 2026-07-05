import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { loadRecipeOfWeekConfig, loadPopularityConfig } from '@/server/app-config'
import { loadGlobalRatingAverage } from '@/server/recipe/popularity'
import { savesAggBodySql, ratingAggBodySql, popularityScoreSql } from '@/server/recipe/search'
import { projectResult, type SearchHitRow, type SearchResult } from '@/domain/recipe-search-read'

/**
 * "Receita da semana" (#457, ADR-0026) — slot EDITORIAL fixo da home. Server-side, ANÔNIMO (sem
 * cookie/sessão — mesmo contrato de `loadDiscoveryFeed`), pra manter a home indexável/cacheável.
 *
 * DUAS fontes, nessa ordem:
 *  1. ESCOLHA DO CURADOR (`recipeOfWeekConfig.recipeId`, via `/admin/catalog`): RE-VALIDADA aqui
 *     contra o estado ATUAL da Receita (`origin=catalog AND curation_status='approved'`, não-
 *     `playful`, não-removida) — nunca confia cegamente no id salvo. Se o Curador trocou de ideia
 *     e rejeitou/despublicou a receita escolhida DEPOIS de escolhê-la, essa query não casa mais
 *     nenhuma linha e o slot degrada pro fallback (2), sem vazar rascunho nem quebrar a home.
 *  2. FALLBACK MECÂNICO por Popularidade (`recipeId` ausente OU escolha inválida): a receita de
 *     MAIOR score de popularidade (mistura save+nota+frescor, #368) dentre o catálogo aprovado.
 *     Espelha a fórmula EXATA de `search.ts` (`popularityScoreSql`) — MESMA disciplina de
 *     self-exclusão e universo vivo (save/nota de usuário soft-deletado não conta).
 *
 * NÃO fere o guarda-corpo "popularidade-sem-autoridade" (CONTEXT.md, Popularidade): aqui ela não
 * promove nada a catálogo (a receita já É catálogo aprovado) — só ordena qual das JÁ aprovadas
 * aparece quando NENHUM humano escolheu. Quem controla o slot primariamente é o Curador.
 *
 * Devolve `null` só quando o catálogo aprovado está VAZIO (nenhuma receita elegível) — a home
 * simplesmente omite o slot nesse caso (não é erro).
 *
 * SEM dedupe com o feed (decisão deliberada): a receita destacada aqui PODE reaparecer no
 * `loadDiscoveryFeed` logo abaixo. Os dois são superfícies independentes (o slot é editorial/fixo,
 * o feed é cronológico) e o custo de coordenar a exclusão entre duas queries paginadas por cursor
 * não compensa o benefício de esconder uma repetição — o selo/manchete já distingue os contextos.
 */
export async function loadRecipeOfTheWeek(
  db: Database,
  requestLocale: string,
): Promise<SearchResult | null> {
  const config = await loadRecipeOfWeekConfig(db)

  if (config.recipeId !== null) {
    const chosen = await loadChosenCatalogRow(db, config.recipeId, requestLocale)
    if (chosen !== null) return projectResult(chosen, requestLocale)
    // Escolha inválida (id nunca existiu, ou a Receita saiu de `approved`/`catalog`/foi removida
    // desde a escolha) ⇒ degrada pro fallback abaixo, SEM lançar/quebrar a home.
  }

  const [cfg, globalAvg] = await Promise.all([loadPopularityConfig(db), loadGlobalRatingAverage(db)])
  const C = globalAvg ?? 3.0 // mesmo fallback em TS de `search.ts` (NUNCA bindar NULL no SQL — ver popularity.ts)
  const top = await loadMostPopularCatalogRow(db, requestLocale, cfg, C)
  return top !== null ? projectResult(top, requestLocale) : null
}

/**
 * Verifica se um `recipeId` é HOJE um catálogo aprovado elegível (origin=catalog, approved,
 * não-playful, não-removida) — usado pelo PUT do admin (`/api/admin/config`) pra recusar a
 * ESCOLHA de uma receita que não é (ainda) catálogo público, ANTES de persistir o id (não é a
 * mesma checagem "leak-safe" da leitura — aqui é um 400 honesto pro Curador: "essa receita não é
 * catálogo aprovado", em vez de silenciosamente aceitar um id que a leitura descartaria depois).
 */
export async function isCatalogRecipeApproved(db: Database, recipeId: string): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT true AS ok
    FROM recipe r
    WHERE r.id = ${recipeId}::uuid
      AND r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
    LIMIT 1
  `)
  return rows.length > 0
}

/** Carrega a linha de display da Receita ESCOLHIDA, gateada (RE-VALIDA elegibilidade nesta query). */
async function loadChosenCatalogRow(
  db: Database,
  recipeId: string,
  requestLocale: string,
): Promise<SearchHitRow | null> {
  const rows = await db.execute<SearchHitRow>(sql`
    SELECT
      r.id AS recipe_id,
      r.origin AS origin,
      r.original_locale AS original_locale,
      r.owner_id AS owner_id,
      'catalogo' AS section,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance,
      NULL AS owner_name, -- catálogo é sempre owner_id NULL: sem autor humano (espelha feedQuery)
      NULL AS owner_handle,
      ri.blob_url AS image_url,
      ri.provenance AS image_provenance,
      req_t.slug AS slug
    FROM recipe r
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = r.id AND req_t.locale = ${requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = r.id AND orig_t.locale = r.original_locale
    LEFT JOIN recipe_image ri
      ON ri.id = r.image_id AND ri.moderated_at IS NULL -- imagem moderada some do público (#133)
    WHERE r.id = ${recipeId}::uuid
      AND r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
    LIMIT 1
  `)
  return rows[0] ?? null
}

/** Teto de resultados do lookup de escolha do Curador (evita payload gigante num `ILIKE` largo). */
export const RECIPE_OF_WEEK_SEARCH_LIMIT = 10

export type RecipeOfWeekSearchHit = { recipeId: string; titulo: string; slug: string | null }

/**
 * Busca por TÍTULO restrita ao catálogo aprovado (#457) — alimenta o PICKER do Curador em
 * `/admin/catalog` (o Curador digita parte do título e escolhe entre os resultados). ADMIN-ONLY
 * pela rota (`requireRole('admin')`); esta função em si é só a query. `titulo`/`slug` do locale
 * PEDIDO — sem tradução naquele locale ⇒ `titulo` cai no ORIGINAL (a receita ainda aparece na
 * busca do curador, mas sem link direto até traduzir). `q` vazio/só-espaço ⇒ `[]` (não lista o
 * catálogo inteiro por engano).
 */
export async function searchCatalogApprovedRecipes(
  db: Database,
  args: { q: string; requestLocale: string },
): Promise<RecipeOfWeekSearchHit[]> {
  const q = args.q.trim()
  if (q === '') return []
  const rows = await db.execute<{ recipe_id: string; titulo: string; slug: string | null }>(sql`
    SELECT r.id AS recipe_id, COALESCE(req_t.titulo, orig_t.titulo) AS titulo, req_t.slug AS slug
    FROM recipe r
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = r.id AND req_t.locale = ${args.requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = r.id AND orig_t.locale = r.original_locale
    WHERE r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
      AND COALESCE(req_t.titulo, orig_t.titulo) ILIKE ${'%' + q + '%'}
    ORDER BY COALESCE(req_t.titulo, orig_t.titulo)
    LIMIT ${RECIPE_OF_WEEK_SEARCH_LIMIT}
  `)
  return rows.map((r) => ({ recipeId: r.recipe_id, titulo: r.titulo, slug: r.slug }))
}

/**
 * Título (locale pedido, ou original) de UM catálogo aprovado por id — alimenta o "escolha atual"
 * exibido no picker do Curador (#457): a config guarda só o `recipeId`; a UI precisa do TÍTULO pra
 * mostrar "Escolhida: <título>" sem o Curador ter de decorar o uuid. `null` quando o id não é
 * (mais) catálogo aprovado (espelha a mesma re-validação da leitura pública).
 */
export async function loadCatalogApprovedRecipeTitle(
  db: Database,
  recipeId: string,
  requestLocale: string,
): Promise<RecipeOfWeekSearchHit | null> {
  const rows = await db.execute<{ recipe_id: string; titulo: string; slug: string | null }>(sql`
    SELECT r.id AS recipe_id, COALESCE(req_t.titulo, orig_t.titulo) AS titulo, req_t.slug AS slug
    FROM recipe r
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = r.id AND req_t.locale = ${requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = r.id AND orig_t.locale = r.original_locale
    WHERE r.id = ${recipeId}::uuid
      AND r.origin = 'catalog'
      AND r.curation_status = 'approved'
      AND r.result_kind <> 'playful'
      AND r.moderation_removed_at IS NULL
    LIMIT 1
  `)
  const row = rows[0]
  return row ? { recipeId: row.recipe_id, titulo: row.titulo, slug: row.slug } : null
}

/** Fallback: a receita de MAIOR score de Popularidade dentre o catálogo aprovado (top-1). */
async function loadMostPopularCatalogRow(
  db: Database,
  requestLocale: string,
  cfg: Awaited<ReturnType<typeof loadPopularityConfig>>,
  C: number,
): Promise<SearchHitRow | null> {
  const rows = await db.execute<SearchHitRow>(sql`
    WITH candidates AS (
      SELECT r.id AS recipe_id, r.origin AS origin, r.original_locale AS original_locale,
             r.owner_id AS owner_id, r.image_id AS image_id, r.created_at AS created_at
      FROM recipe r
      WHERE r.origin = 'catalog'
        AND r.curation_status = 'approved'
        AND r.result_kind <> 'playful'
        AND r.moderation_removed_at IS NULL
    )
    SELECT
      c.recipe_id AS recipe_id,
      c.origin AS origin,
      c.original_locale AS original_locale,
      c.owner_id AS owner_id,
      'catalogo' AS section,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance,
      NULL AS owner_name,
      NULL AS owner_handle,
      ri.blob_url AS image_url,
      ri.provenance AS image_provenance,
      req_t.slug AS slug
    FROM candidates c
    LEFT JOIN (${savesAggBodySql}) sv ON sv.recipe_id = c.recipe_id
    LEFT JOIN (${ratingAggBodySql}) rt ON rt.recipe_id = c.recipe_id
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = c.recipe_id AND req_t.locale = ${requestLocale}
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = c.recipe_id AND orig_t.locale = c.original_locale
    LEFT JOIN recipe_image ri
      ON ri.id = c.image_id AND ri.moderated_at IS NULL
    ORDER BY (${popularityScoreSql(cfg, C, sql`c.created_at`)}) DESC, c.recipe_id
    LIMIT 1
  `)
  return rows[0] ?? null
}
