import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { followeesPublicSqlFragment, viewerReadableSqlFragment } from '@/server/recipe/visibility-sql'
import { listFollowingIds } from '@/server/user/follow'
import {
  buildFeedResponse,
  FEED_DEFAULT_LIMIT,
  type FeedHitRow,
  type FeedCursor,
  type FeedResponse,
} from '@/domain/recipe-feed-read'

/**
 * Template SQL CRU do Feed (#103) — FONTE ÚNICA do shape de query usada por `loadFeed` (pool da
 * comunidade/viewer) E por `loadFollowingFeed` (#277, pool dos seguidos). O ÚNICO ponto variável é
 * o `scopeSql` (o predicado de POSSE/visibilidade): os predicados CONSTANTES do pool
 * (`result_kind <> 'playful'`, `moderation_removed_at IS NULL`) e o cursor keyset vivem aqui, então
 * os dois feeds compartilham EXATAMENTE o mesmo display (tradução/imagem/slug) e a mesma paginação.
 *
 * Reusa o PADRÃO de display da Busca (double LEFT JOIN de tradução: locale pedido + original) para
 * `displayedTitle`/`autoTranslationSignal` saírem idênticos aos da Busca — mas NÃO reusa
 * `displayTailSql` (que pende de um CTE `numbered` sem `created_at`, que o cursor precisa). Query
 * auto-contida: o LIMIT vive no CTE interno `feed_rows` (só junta tradução das linhas da página); o
 * SELECT externo re-ordena (o JOIN pode embaralhar) por `created_at, id`.
 *
 * Keyset (FONTE ÚNICA, construído AQUI a partir do `cursor` decodificado — nunca passado pré-montado
 * pelos chamadores, p/ os dois feeds não desincronizarem a inequação): `(created_at, id) < (cursor)`
 * sob a ordem DESC pega a "próxima página" (linhas mais antigas) de forma estável, sem drift de
 * offset. `created_at` sai como `::text` canônico p/ o cursor round-tripar com precisão de
 * microssegundos. Imagem MODERADA some do público via `ri.moderated_at IS NULL` no LEFT JOIN (#133).
 *
 * v1 (consciente, como a Busca): sem índice composto em `(created_at, id)` ainda — o planner faz Sort
 * sobre o gate. ACEITO no v1 (tabelas minúsculas); índice parcial deferido.
 *
 * LANDMINE: NENHUM backtick dentro do template `sql\`...\`` (nem em comentário) — terminaria o
 * template. Comentários explicativos ficam AQUI, fora dele.
 */
function feedQuery(args: {
  requestLocale: string
  limit: number
  cursor: FeedCursor | null
  scopeSql: SQL
}): SQL {
  const { requestLocale, limit, cursor, scopeSql } = args

  // Predicado keyset: vazio na 1a pagina (cursor null), inequacao de row-value depois. Bind
  // seguro via param do template (cast ::timestamptz/::uuid; valor invalido foi descartado na borda).
  const cursorSql: SQL = cursor
    ? sql`AND (r.created_at, r.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : sql``

  return sql`
    WITH params AS (
      SELECT ${requestLocale}::text AS req_locale
    ),
    feed_rows AS (
      SELECT
        r.id AS recipe_id,
        r.origin AS origin,
        r.original_locale AS original_locale,
        r.owner_id AS owner_id,
        r.image_id AS image_id,
        CASE WHEN r.origin = 'catalog' THEN 'catalogo' ELSE 'comunidade' END AS section,
        r.created_at AS created_at_ts,
        r.created_at::text AS created_at
      FROM recipe r
      WHERE r.result_kind <> 'playful'
        AND ${scopeSql}
        AND r.moderation_removed_at IS NULL -- gate de pool #18: ver recipe-pool.ts
        ${cursorSql}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit + 1}
    )
    SELECT
      fr.recipe_id AS recipe_id,
      fr.origin AS origin,
      fr.original_locale AS original_locale,
      fr.owner_id AS owner_id,
      fr.section AS section,
      fr.created_at AS created_at,
      req_t.titulo AS requested_titulo,
      req_t.provenance AS requested_provenance,
      orig_t.titulo AS original_titulo,
      orig_t.provenance AS original_provenance,
      u.name AS owner_name,
      u.handle AS owner_handle,
      ri.blob_url AS image_url,
      ri.provenance AS image_provenance,
      req_t.slug AS slug -- #231: slug do locale PEDIDO (mesmo LEFT JOIN do título) pro link canônico
    FROM feed_rows fr
    CROSS JOIN params p
    LEFT JOIN recipe_translation req_t
      ON req_t.recipe_id = fr.recipe_id AND req_t.locale = p.req_locale
    LEFT JOIN recipe_translation orig_t
      ON orig_t.recipe_id = fr.recipe_id AND orig_t.locale = fr.original_locale
    LEFT JOIN users u
      ON u.id = fr.owner_id
    LEFT JOIN recipe_image ri
      ON ri.id = fr.image_id AND ri.moderated_at IS NULL -- #133: imagem moderada some do público
    ORDER BY fr.created_at_ts DESC, fr.recipe_id DESC
  `
}

/**
 * Loader do Feed (#103). Lista PLANA e cronológica do pool da COMUNIDADE/VIEWER, paginada por CURSOR
 * keyset. Diverge do loader da Busca (`search.ts`): SEM FTS/ranking/semântica/seccionamento.
 *
 * Gate de leitura do VIEWER (#116, espelha o `visible` da Busca): `viewerReadableSqlFragment('r',
 * viewerId)` (+ os constantes do template `feedQuery`). Anônimo (`viewerId` undefined, ADR-0011) ⇒ o
 * fragmento reduz a `(owner_id IS NULL OR visibility = 'public')` — gate de pool byte-a-byte com o de
 * antes. LOGADO ⇒ adiciona a arma `OR owner_id = <viewerId>` (BINDADO), incluindo as PRÓPRIAS Receitas
 * (privadas inclusive).
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
  const rows = await db.execute<FeedHitRow>(
    feedQuery({ requestLocale, limit, cursor, scopeSql: viewerReadableSqlFragment('r', viewerId) }),
  )
  return [...rows]
}

/**
 * Loader do Feed SEGUINDO (#277, ADR-0024) — as Receitas PÚBLICAS dos Cozinheiros que o `viewerId`
 * SEGUE, mais novas primeiro, paginadas pelo MESMO cursor keyset do `loadFeed`. Superfície SÓ-LOGADA
 * e NÃO-INDEXÁVEL (Modelo B: separada da home anon; nunca personaliza a Descoberta/perfil).
 *
 * Gate = `followeesPublicSqlFragment('r', ids)` — `visibility='public' AND origin<>'web_imported' AND
 * owner_id IN (seguidos)` — combinado com os constantes do template (`result_kind<>'playful'`,
 * `moderation_removed_at IS NULL`). EXCLUI: catálogo (owner NULL nunca casa `IN`), privada de 3º
 * (`visibility='public'`), removida-do-pool + playful (constantes), importada da web (eixo explícito).
 * O `viewer` NUNCA aparece (não se segue a si — `auto_seguir` barrado), então `isOwn` é sempre false.
 *
 * Os `ids` dos seguidos VÊM do seam `listFollowingIds` (alive-gated — conta desativada some, fonte
 * única do gate de soft-delete; NÃO re-derivar aqui). CURTO-CIRCUITO `ids.length === 0 → []` é o
 * PRIMEIRO statement (antes de QUALQUER montagem de SQL): `IN ()` é erro de sintaxe (→ 500) e, sem
 * seguidos, não há o que buscar — zero ida ao DB.
 */
export async function loadFollowingFeed(
  db: Database,
  args: { viewerId: string; requestLocale: string; limit: number; cursor: FeedCursor | null },
): Promise<FeedHitRow[]> {
  const ids = await listFollowingIds(db, args.viewerId)
  if (ids.length === 0) return [] // sem seguidos: nada a buscar + evita `IN ()` inválido. NÃO mover.
  const { requestLocale, limit, cursor } = args
  const rows = await db.execute<FeedHitRow>(
    feedQuery({ requestLocale, limit, cursor, scopeSql: followeesPublicSqlFragment('r', ids) }),
  )
  return [...rows]
}

/**
 * Feed da Descoberta-home (#236, ADR-0020) — a 1ª página ANÔNIMA do POOL PÚBLICO que o Server
 * Component da home (`/{locale}`) renderiza no estado de REPOUSO (INDEXÁVEL). Junta o load DIRETO do
 * DB (`loadFeed` com `viewerId: undefined`) ao montador PURO (`buildFeedResponse`), espelhando o que o
 * route `/api/feed` faz pra o anônimo — mas SEM passar pela rota (sem self-fetch) e SEM cookie/sessão:
 * o caminho de repouso da home tem de ficar cacheável e indexável, igual ao detalhe público (#230).
 *
 * `viewerId` é FIXO `undefined` (anônimo) DE PROPÓSITO: o conteúdo indexável é o MESMO pool do sitemap
 * (#235) — `eligibleForPublicRead` (catálogo/comunidade pública, não-`playful`, não-removida). NUNCA
 * server-renderiza feed personalizado-por-sessão aqui (vazaria privadas e mataria o cache). A
 * personalização do logado (próprias receitas) vive na superfície PESSOAL ("Minhas criações"), não na
 * home indexável.
 *
 * Devolve a `FeedResponse` (1ª página + `nextCursor`) — o Server Component a passa como `initialFeed`/
 * `initialNextCursor` ao cliente, que pagina daí pra frente via `/api/feed` (também anônimo).
 */
export async function loadDiscoveryFeed(
  db: Database,
  args: { requestLocale: string; limit?: number },
): Promise<FeedResponse> {
  const limit = args.limit ?? FEED_DEFAULT_LIMIT
  // ANÔNIMO (viewerId undefined): pool público, sem cookie — cacheável/indexável. 1ª página (cursor null).
  const rows = await loadFeed(db, { requestLocale: args.requestLocale, limit, cursor: null, viewerId: undefined })
  // `viewerId` omitido ⇒ `isOwn` sempre false (nenhum dono casa undefined): selo de comunidade/catálogo.
  return buildFeedResponse(rows, args.requestLocale, limit)
}
