import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import type { SearchHitRow } from '@/domain/recipe-search-read'

/**
 * Loader FTS multi-row da Busca (issue #6, §3.4). Diverge de `loadRecipeRows`
 * (que carrega UMA Receita via query builder): aqui é UMA query SQL crua via
 * `db.execute<SearchHitRow>(sql\`...\`)`, parametrizada pelo template do Drizzle
 * (bind seguro de `q`/`requestLocale`, sem interpolação → sem injeção).
 *
 * A query: casa CROSS-LOCALE (cada linha de `recipe_translation` é indexada na
 * sua própria config via a coluna gerada `search_vector`; o tsquery é construído
 * na MESMA config por linha — `recipe_ts_config(rt.locale)` — para os lexemas
 * casarem) → dedup por Receita (`MAX(ts_rank)` entre as traduções que casaram) →
 * junta a espinha e aplica o GATE DE LEITURA CANÔNICO (espelha `route.ts:45`
 * `isPublicRead`: `owner_id IS NULL OR visibility='public'`, mais a exclusão
 * explícita de `playful`) → secciona por `origin` → cap por seção via ROW_NUMBER
 * particionado. O LEFT JOIN duplo (tradução do locale pedido + tradução do
 * original) entrega ao módulo PURO `buildSearchResponse` os campos de que
 * `resolveName` + o sinal precisam.
 *
 * `SearchHitRow` é OWNED pelo domínio (`@/domain/recipe-search-read`): o domínio
 * define o contrato de linha e o server o preenche (espelha `recipe-read.ts`
 * definindo `RecipeRow`/`TranslationRow` e `load.ts` consumindo-os).
 *
 * Nota de plano (§3.4): como a config do `@@` é correlacionada por linha, o
 * tsquery NÃO é constante de planejamento ⇒ o Postgres rebaixa o `@@` a um Filter
 * sobre Seq Scan (não usa o GIN nesta query). ACEITO no v1 (tabela minúscula, cap
 * ~50). O índice GIN segue valioso para call sites FUTUROS de config constante
 * (#9/#10/#14); §4.4 prova a usabilidade do índice nesse caminho.
 */

const MAX_QUERY_LEN = 256
const SECTION_CAP = 50

export async function searchRecipes(
  db: Database,
  args: { q: string; requestLocale: string },
): Promise<SearchHitRow[]> {
  // Cap de entrada: truncar (não rejeitar). O curto-circuito de estado neutro
  // (q vazio/só-espaços) vive no ROUTE; aqui, q vazio ⇒ websearch_to_tsquery
  // devolve query vazia ⇒ zero linhas (defensivamente seguro).
  const q = args.q.slice(0, MAX_QUERY_LEN)
  const requestLocale = args.requestLocale

  const rows = await db.execute<SearchHitRow>(sql`
    WITH params AS (
      SELECT ${requestLocale}::text AS req_locale
    ),
    matched AS (
      -- Match cross-locale + rank por LINHA de tradução; per-row config no tsquery
      -- (a MESMA config do índice da linha, recipe_ts_config(rt.locale)).
      SELECT
        rt.recipe_id AS recipe_id,
        ts_rank(
          rt.search_vector,
          websearch_to_tsquery(
            recipe_ts_config(rt.locale),
            immutable_unaccent(${q})
          )
        ) AS rank
      FROM recipe_translation rt
      WHERE rt.search_vector @@ websearch_to_tsquery(
        recipe_ts_config(rt.locale),
        immutable_unaccent(${q})
      )
    ),
    ranked AS (
      -- Dedup por Receita: MAX rank entre as traduções que casaram.
      SELECT recipe_id, MAX(rank) AS rank
      FROM matched
      GROUP BY recipe_id
    ),
    visible AS (
      -- Junta a espinha; GATE DE LEITURA CANÔNICO uniforme (espelha route.ts:45
      -- isPublicRead): owner NULL (catálogo/sistema, ADR-0011) OU visibility=public.
      -- Catálogo nasce private (default DB) mas owner_id NULL ⇒ legível. Private de
      -- usuário (owned) nunca passa. playful excluído explicitamente (defesa em
      -- profundidade AC3). Seção PURAMENTE por origin.
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        ranked.rank AS rank,
        -- a coluna section dirige SÓ a partição/cap do ROW_NUMBER por seção; o
        -- agrupamento (fonte da verdade) é classifySection(origin) em buildSearchResponse.
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section
      FROM ranked
      JOIN recipe r ON r.id = ranked.recipe_id
      WHERE r.result_kind <> 'playful'
        AND (r.owner_id IS NULL OR r.visibility = 'public')
    ),
    numbered AS (
      -- Ranking SÓ DENTRO DA SEÇÃO + cap (ROW_NUMBER particionado por seção;
      -- recipe_id como tiebreaker determinístico).
      SELECT
        visible.recipe_id AS recipe_id,
        visible.origin AS origin,
        visible.original_locale AS original_locale,
        visible.section AS section,
        ROW_NUMBER() OVER (
          PARTITION BY visible.section
          ORDER BY visible.rank DESC, visible.recipe_id
        ) AS rn
      FROM visible
    )
    SELECT
      n.recipe_id AS recipe_id,
      n.origin AS origin,
      n.original_locale AS original_locale,
      n.section AS section,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance
    FROM numbered n
    CROSS JOIN params p
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = n.recipe_id AND req_t.locale = p.req_locale
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = n.recipe_id AND orig_t.locale = n.original_locale
    WHERE n.rn <= ${SECTION_CAP}
    ORDER BY n.section, n.rn
  `)

  // postgres-js devolve um array-like/iterável; materializa o SearchHitRow[].
  return [...rows]
}
