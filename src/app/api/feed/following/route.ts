import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { resolveLocale } from '@/i18n/locale'
import { loadFollowingFeed } from '@/server/recipe/feed'
import { buildFeedResponse, decodeCursor, parseFeedLimit } from '@/domain/recipe-feed-read'

/**
 * Feed SEGUINDO (#277, ADR-0024): GET `?cursor=&limit=&locale=` — as Receitas PÚBLICAS dos
 * Cozinheiros que o VIEWER segue, paginadas pelo MESMO cursor keyset de `/api/feed`. Route FINO
 * (espelha `/api/feed`): canonicaliza o locale, delega o load ao `loadFollowingFeed` e o display ao
 * módulo PURO `buildFeedResponse`.
 *
 * SÓ-LOGADO (contraste DELIBERADO com `/api/feed`, que é auth-OPCIONAL): `requireSession` ANTES do
 * DB ⇒ Visitante/conta-desativada = 401, zero efeito colateral. É uma superfície PERSONALIZADA por
 * viewer — Modelo B a mantém SEPARADA da home anon/indexável.
 *
 * `Cache-Control: no-store` (espelha o GET de `/api/u/<handle>/follow`): a resposta é per-viewer
 * (escopada a quem o viewer segue) e NUNCA pode ser edge-cacheada como resposta compartilhada —
 * senão o feed de um viewer vazaria pra outro (falha Modelo B canônica).
 *
 * `viewerId` é passado ao `buildFeedResponse` como defense-in-depth: o feed nunca contém Receita
 * própria (não se segue a si — `auto_seguir` é barrado), então `isOwn` é sempre false; passá-lo
 * apenas se auto-corrige se aquele guard regredir, sem custo. Bordas PERMISSIVAS iguais ao `/api/feed`
 * (limit inválido → default; cursor malformado → começo do feed). Nunca 400/500 por input de URL.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  // Sessão ANTES do DB: superfície SÓ-LOGADA. Anon/conta-desativada ⇒ 401 (g.response), zero efeito.
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id

  const url = new URL(request.url)
  const requestLocale = resolveLocale({ preferred: url.searchParams.get('locale') })
  const limit = parseFeedLimit(url.searchParams.get('limit'))
  const cursor = decodeCursor(url.searchParams.get('cursor'))

  const rows = await loadFollowingFeed(getDb(), { viewerId, requestLocale, limit, cursor })
  const body = buildFeedResponse(rows, requestLocale, limit, viewerId)
  // Per-viewer ⇒ no-store (nunca compartilhado por edge/CDN). Ver `/api/u/<handle>/follow` GET.
  return Response.json(body, { headers: { 'cache-control': 'no-store' } })
}
