import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
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
 * (Catálogo + Comunidade), paginada por cursor keyset — scroll infinito. Route FINO (espelha
 * `api/search/route.ts`): canonicaliza o locale na borda, delega o load ao `loadFeed` e o
 * display ao módulo PURO `buildFeedResponse`.
 *
 * AUTH OPCIONAL (#116): resolve a sessão SEM 401 — Visitante (ADR-0011) segue com acesso de
 * leitura ao pool da comunidade; LOGADO recebe `viewerId` e o feed inclui também as PRÓPRIAS
 * Receitas (privadas inclusive). `requireSession` falhando (anônimo/conta desativada) ⇒
 * `viewerId` undefined ⇒ comportamento de antes byte-a-byte (NUNCA propaga o 401 daqui).
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

  // #116: sessão OPCIONAL — anônimo (ou conta desativada) NÃO é 401 aqui, só não recebe
  // `viewerId`. LOGADO ⇒ o feed inclui também as próprias Receitas (privadas inclusive).
  const g = await requireSession(request)
  const viewerId = g.ok ? g.session.user.id : undefined

  const db = getDb()
  const rows = await loadFeed(db, { requestLocale, limit, cursor, viewerId })
  const body = buildFeedResponse(rows, requestLocale, limit)
  return Response.json(body)
}
