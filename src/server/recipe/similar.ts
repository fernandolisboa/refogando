import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { communityVisibleSqlFragment } from '@/server/recipe/visibility-sql'
import { SEMANTIC_MIN_SIM, displayTailSql } from '@/server/recipe/search'
import type { SearchHitRow } from '@/domain/recipe-search-read'

/** Trilho de 3-4 cards (#454) — cap fixo, sem paginação (não é uma lista, é uma vitrine). */
export const SIMILAR_RECIPES_LIMIT = 4

/**
 * Loader de "Receitas semelhantes" (#454) — vizinhos por SIMILARIDADE DE COSSENO do embedding da
 * PRÓPRIA receita (`recipe_embedding`, pgvector, já existe — zero custo de IA nesta leitura: não
 * embeda nada na hora, só compara vetores já computados). Server-rendered, cacheável (sem
 * `viewerId`: é uma vitrine PÚBLICA não-personalizada, igual pros dois caminhos do detalhe).
 *
 * INEGOCIÁVEL (memória ADR-0026, #238): filtra pelos MESMOS 4 gates de `eligibleForPool`
 * (`@/domain/recipe-pool`) — `((owner_id IS NULL AND curation_status='approved') OR
 * visibility='public') AND result_kind<>'playful' AND moderation_removed_at IS NULL AND
 * origin<>'web_imported'`. Receita privada, moderada, pendente de curadoria ou importada da web
 * JAMAIS pode aparecer como "semelhante" — nem a própria receita-base sendo privada deveria expor
 * QUEM é parecido com ela (mas essa checagem é responsabilidade do CALLER: só chame este loader
 * depois de confirmar que a receita-base em si já passou pelo gate de leitura pública/dono).
 *
 * SEM embedding próprio pro locale pedido (receita nova, catálogo legado pré-seed, `stale`
 * irrelevante aqui — só `embedding IS NOT NULL` importa): a CTE `own` fica vazia, o `WHERE`
 * downstream não casa nada (comparar com vetor NULL nunca satisfaz `>= SEMANTIC_MIN_SIM`), e o
 * loader devolve `[]` — o caller OMITE o trilho inteiro (ausente ≠ vazio, mesmo princípio do
 * resto do app), nunca renderiza uma seção vazia nem lança erro.
 *
 * DISTINCT ON dedup por candidato (mesmo padrão de `semanticSelectSql`, `search.ts`): prefere o
 * embedding do MESMO locale pedido quando existe; senão o mais próximo entre os outros locales da
 * mesma receita candidata. `cosine_sim <> 'NaN'::float8` descarta embedding de norma-zero (S2,
 * mesmo landmine do `search.ts` — `NaN >= limiar` seria TRUE e ordenaria primeiro).
 */
export async function loadSimilarRecipes(
  db: Database,
  args: { recipeId: string; locale: string; limit?: number },
): Promise<SearchHitRow[]> {
  const limit = args.limit ?? SIMILAR_RECIPES_LIMIT
  const rows = await db.execute<SearchHitRow>(sql`
    WITH params AS (
      SELECT ${args.locale}::text AS req_locale
    ),
    own AS (
      SELECT embedding FROM recipe_embedding
      WHERE recipe_id = ${args.recipeId}::uuid
        AND locale = ${args.locale}
        AND embedding IS NOT NULL
      LIMIT 1
    ),
    candidates AS (
      -- #454: candidato = OUTRA receita com embedding, elegível ao pool (4 gates de
      -- eligibleForPool), dedup por recipe_id preferindo o embedding do locale pedido.
      SELECT DISTINCT ON (re.recipe_id)
        re.recipe_id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        r.owner_id AS owner_id,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        (1 - (re.embedding <=> (SELECT embedding FROM own))) AS cosine_sim
      FROM recipe_embedding re
      JOIN recipe r ON r.id = re.recipe_id
      CROSS JOIN own
      WHERE re.recipe_id <> ${args.recipeId}::uuid
        AND re.embedding IS NOT NULL
        AND r.result_kind <> 'playful'
        AND ${communityVisibleSqlFragment('r')}
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        AND r.origin <> 'web_imported' -- gate de pool #168/ADR-0019: ver recipe-pool.ts
      ORDER BY re.recipe_id, (re.locale = ${args.locale}) DESC, (re.embedding <=> (SELECT embedding FROM own)) ASC
    ),
    numbered AS (
      -- recipe_id como 2a chave (achado de code-review): sem tiebreaker deterministico, um
      -- empate EXATO de cosseno (plausivel em float4/pgvector, ou catalogo quase-duplicado)
      -- deixaria a ordem entre os empatados indefinida entre execucoes -- poderia trocar QUEM
      -- entra no cap de N de um request pro outro (quebra cacheabilidade/consistencia visual).
      -- Mesmo padrao do CTE numbered principal de search.ts.
      SELECT
        recipe_id, origin, original_locale, owner_id, section,
        ROW_NUMBER() OVER (ORDER BY cosine_sim DESC, recipe_id) AS rn
      FROM candidates
      WHERE cosine_sim >= ${SEMANTIC_MIN_SIM}
        AND cosine_sim <> 'NaN'::float8
    )
    ${displayTailSql(sql`n.rn <= ${limit}`, sql`n.rn`)}
  `)
  return [...rows]
}
