import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { viewerReadableSqlFragment } from '@/server/recipe/visibility-sql'
import type { FeedHitRow, FeedCursor } from '@/domain/recipe-feed-read'

/**
 * Loader do Feed (#103). Lista PLANA e cronológica do pool, paginada por CURSOR keyset.
 * Diverge do loader da Busca (`search.ts`): SEM FTS/ranking/semântica/seccionamento — só o
 * gate de leitura canônico + ordem `created_at DESC, id DESC` + cursor keyset.
 *
 * Reusa o PADRÃO de display da Busca (double LEFT JOIN de tradução: locale pedido + original)
 * para `displayedTitle`/`autoTranslationSignal` saírem idênticos aos da Busca — mas NÃO reusa
 * `displayTailSql` (que pende de um CTE `numbered` sem `created_at`, que o cursor precisa).
 * Query auto-contida: o LIMIT vive no CTE interno `feed_rows` (só junta tradução das linhas da
 * página); o SELECT externo re-ordena (o JOIN pode embaralhar) por `created_at, id`.
 *
 * Gate de leitura do VIEWER (#116, espelha o `visible` da Busca): `result_kind <> 'playful'`
 * AND `viewerReadableSqlFragment('r', viewerId)` AND `moderation_removed_at IS NULL`. Anônimo
 * (`viewerId` undefined, ADR-0011) ⇒ o fragmento reduz a `(owner_id IS NULL OR visibility =
 * 'public')` — gate de pool byte-a-byte com o de antes. LOGADO ⇒ adiciona a arma
 * `OR owner_id = <viewerId>` (BINDADO), incluindo as PRÓPRIAS Receitas (privadas inclusive).
 *
 * Keyset: `(created_at, id) < (cursor)` sob a ordem DESC pega a "próxima página" (linhas mais
 * antigas) de forma estável, sem drift de offset. `created_at` sai como `::text` canônico p/
 * o cursor round-tripar com precisão de microssegundos.
 *
 * v1 (consciente, como a Busca): sem índice composto em `(created_at, id)` ainda — o planner
 * faz Sort sobre o gate. ACEITO no v1 (tabelas minúsculas); índice parcial deferido.
 *
 * LANDMINE: NENHUM backtick dentro do template `sql\`...\`` (nem em comentário) — terminaria
 * o template. Comentários explicativos ficam AQUI, fora dele.
 */
export async function loadFeed(
  db: Database,
  args: {
    requestLocale: string
    limit: number
    cursor: FeedCursor | null
    /**
     * Viewer LOGADO (#116): inclui as PRÓPRIAS Receitas (privadas inclusive) além do pool da
     * comunidade. `undefined` (anônimo, ADR-0011) ⇒ só o pool — comportamento de antes.
     */
    viewerId?: string
  },
): Promise<FeedHitRow[]> {
  const { requestLocale, limit, cursor, viewerId } = args

  // Predicado keyset: vazio na 1a pagina (cursor null), inequacao de row-value depois. Bind
  // seguro via sql.param (cast ::timestamptz/::uuid; valor invalido foi descartado na borda).
  const cursorSql: SQL = cursor
    ? sql`AND (r.created_at, r.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : sql``

  const rows = await db.execute<FeedHitRow>(sql`
    WITH params AS (
      SELECT ${requestLocale}::text AS req_locale
    ),
    feed_rows AS (
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        r.created_at AS created_at_ts,
        r.created_at::text AS created_at
      FROM recipe r
      WHERE r.result_kind <> 'playful'
        AND ${viewerReadableSqlFragment('r', viewerId)}
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        ${cursorSql}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit + 1}
    )
    SELECT
      fr.recipe_id AS recipe_id,
      fr.origin AS origin,
      fr.original_locale AS original_locale,
      fr.section AS section,
      fr.created_at AS created_at,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance
    FROM feed_rows fr
    CROSS JOIN params p
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = fr.recipe_id AND req_t.locale = p.req_locale
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = fr.recipe_id AND orig_t.locale = fr.original_locale
    ORDER BY fr.created_at_ts DESC, fr.recipe_id DESC
  `)

  return [...rows]
}
