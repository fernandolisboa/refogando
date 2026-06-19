/**
 * Montagem PURA do DTO do Feed (#103). Sem DB, sem I/O: recebe as linhas já carregadas
 * (`FeedHitRow[]`, limite+1) + o `requestLocale` e devolve a `FeedResponse` que o route
 * serializa. Espelha `recipe-search-read.ts` (mesma separação route↔domínio), mas é PLANO
 * (sem seções) e paginado por CURSOR keyset — não por seção/cap.
 *
 * Reusa `projectResult` (#6) para o mapeamento por-linha (displayedTitle + autoTranslation),
 * sem re-derivar a resolução de nome/proveniência. A única diferença vs. a Busca é a forma:
 * lista plana cronológica + cursor opaco.
 */
import {
  projectResult,
  type SearchHitRow,
  type SearchResult,
} from '@/domain/recipe-search-read'

/**
 * Linha do Feed: os 8 campos de display da Busca + `created_at` (o cursor keyset precisa do
 * par (created_at, id) da última linha). `created_at` trafega como TEXTO canônico do Postgres
 * (`::text` no SELECT) p/ o cursor round-tripar sem perda de precisão de microssegundos.
 */
export type FeedHitRow = SearchHitRow & { created_at: string }

/**
 * DTO do Feed: lista PLANA (sem Catálogo/Comunidade — o selo de proveniência por item já
 * distingue a origem) + `nextCursor` opaco. `nextCursor === null` ⇒ fim do feed.
 */
export type FeedResponse = {
  feed: SearchResult[]
  nextCursor: string | null
}

/** Página default e teto do feed (anti-fan-out; espelha o espírito do SECTION_CAP da Busca). */
export const FEED_DEFAULT_LIMIT = 20
export const FEED_MAX_LIMIT = 50

/** Conteúdo decodificado do cursor: o par keyset (created_at, id) da última linha entregue. */
export type FeedCursor = { createdAt: string; id: string }

/** UUID canônico (id da Receita). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * Forma TEXTO do `timestamptz` que o Postgres emite (`created_at::text`): `YYYY-MM-DD HH:MM:SS`
 * (espaço OU 'T'), fração opcional, offset opcional (`+00`, `+00:00`, `-0300`, `Z` ou nada).
 * Validar a FORMA aqui é o que mantém a borda permissiva: um cursor com valor que NÃO casaria
 * o cast `::timestamptz` no SQL é rejeitado ANTES de tocar o DB (vira "começo do feed"),
 * evitando o 500 que `'lixo'::timestamptz` dispararia (a rota não tem try/catch — é de propósito,
 * pra erro de DB real continuar 500; só o input de URL é que NUNCA pode virar 500).
 */
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?([+-]\d{2}(:?\d{2})?|Z)?$/

/**
 * Cursor OPACO: base64 de `{c: created_at, i: id}`. O cliente o trata como string cega e o
 * devolve verbatim. Usa `btoa`/`atob` (isomórfico, sem Buffer) — o conteúdo é ASCII
 * (timestamp + uuid). NÃO é segredo nem assinado: só carrega a posição keyset.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ c: createdAt, i: id }))
}

/**
 * Decodifica o cursor; PERMISSIVO (espelha o parse de faceta da Busca): qualquer cursor
 * malformado ⇒ `null` (o route trata como "do começo", NUNCA 400/500 — política "nunca tela
 * quebrada"). Valida a forma `{c: string, i: string}` não-vazia.
 */
export function decodeCursor(raw: string | null): FeedCursor | null {
  if (raw === null || raw.length === 0) return null
  try {
    const parsed: unknown = JSON.parse(atob(raw))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'c' in parsed &&
      'i' in parsed &&
      typeof (parsed as { c: unknown }).c === 'string' &&
      typeof (parsed as { i: unknown }).i === 'string'
    ) {
      const c = (parsed as { c: string }).c
      const i = (parsed as { i: string }).i
      // Valida o VALOR, não só a forma do objeto: `i` precisa ser UUID e `c` um timestamptz
      // textual. Sem isto, um cursor base64 bem-formado com valor lixo (ex.: c='x', i='y')
      // passaria e estouraria o cast `::timestamptz`/`::uuid` no loader → 500. Com a validação,
      // cursor inválido → null → começo do feed (política permissiva da borda).
      if (UUID_RE.test(i) && TIMESTAMPTZ_RE.test(c)) return { createdAt: c, id: i }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Monta a `FeedResponse` a partir das linhas carregadas (até `limit + 1`). A linha EXTRA
 * (limit+1) só sinaliza `hasMore`: é descartada do payload. `nextCursor` sai do par
 * (created_at, id) da ÚLTIMA linha da PÁGINA (índice limit-1) — keyset estável, sem drift de
 * offset. Linha sem título exibível é PULADA por `projectResult` (defesa "nunca tela
 * quebrada"), mas ainda conta para a posição do cursor (paginação é por linha, não por item
 * exibido).
 */
export function buildFeedResponse(
  rows: ReadonlyArray<FeedHitRow>,
  requestLocale: string,
  limit: number,
): FeedResponse {
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows.slice()

  const feed: SearchResult[] = []
  for (const row of pageRows) {
    const result = projectResult(row, requestLocale)
    if (result !== null) feed.push(result)
  }

  const last = pageRows[pageRows.length - 1]
  const nextCursor = hasMore && last !== undefined ? encodeCursor(last.created_at, last.recipe_id) : null

  return { feed, nextCursor }
}
