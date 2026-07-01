import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { loadNotifications } from '@/server/notification'

/**
 * Caixa de Notificações (#371, ADR-0028) — GET `/api/notifications` → `{ notifications, unreadCount,
 * nextCursor }`. SÓ-LOGADO (`requireSession` ANTES do DB ⇒ Visitante/conta-desativada = 401). O
 * `viewerId` é SEMPRE `session.user.id` (NUNCA de query — anti-IDOR: senão um logado leria a caixa de
 * outro). O `limit` é SERVER-controlled (`NOTIFICATIONS_PAGE_SIZE`, nunca lê `?limit=`); só o `?cursor=`
 * (opaco/tolerante) vem do cliente. `Cache-Control: no-store` (per-viewer, nunca edge-cacheável).
 */
export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id // HARD-WIRED da sessão — nunca de query/body (anti-IDOR).
  const cursor = new URL(request.url).searchParams.get('cursor')
  const page = await loadNotifications(getDb(), viewerId, { cursor })
  return Response.json(page, { headers: { 'cache-control': 'no-store' } })
}
