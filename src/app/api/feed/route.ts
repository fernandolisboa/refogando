import { getDb } from '@/server/deps'
import { resolveLocale } from '@/i18n/locale'
import { loadFeed } from '@/server/recipe/feed'
import {
  buildFeedResponse,
  decodeCursor,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
} from '@/domain/recipe-feed-read'

/**
 * Feed do /recipes (#103): GET `?cursor=&limit=&locale=`. Lista PLANA e cronológica do pool
 * (Catálogo + Comunidade), paginada por cursor keyset — scroll infinito. SEM auth (Visitante
 * anônimo, ADR-0011). Route FINO (espelha `api/search/route.ts`): canonicaliza o locale na
 * borda, delega o load ao `loadFeed` e o display ao módulo PURO `buildFeedResponse`.
 *
 * Bordas PERMISSIVAS (política "nunca tela quebrada"): `limit` inválido → default; `cursor`
 * malformado → começo do feed (decodeCursor → null). Nunca 400/500 por input de URL.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/** Parse permissivo do limit: inteiro em [1, FEED_MAX_LIMIT]; ausente/inválido → default. */
function parseLimit(raw: string | null): number {
  if (raw === null) return FEED_DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) return FEED_DEFAULT_LIMIT
  return Math.min(n, FEED_MAX_LIMIT)
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const requestLocale = resolveLocale({ preferred: url.searchParams.get('locale') })
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeCursor(url.searchParams.get('cursor'))

  const db = getDb()
  const rows = await loadFeed(db, { requestLocale, limit, cursor })
  const body = buildFeedResponse(rows, requestLocale, limit)
  return Response.json(body)
}
