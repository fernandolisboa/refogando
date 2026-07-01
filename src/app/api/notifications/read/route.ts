import { getDb } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { markRead } from '@/server/notification'

/**
 * Marcar notificações como lidas (#371, ADR-0028) — POST `/api/notifications/read` → `{ unreadCount }`.
 * SÓ-LOGADO (anon → 401). `viewerId` da sessão (anti-IDOR). Body TOLERANTE `{ ids?: string[] }`:
 *  - `ids` presente e array → marca só essas (o server valida cada uuid; ver `markRead`);
 *  - `ids` ausente / body não-JSON / `ids` não-array → tratado como AUSENTE = marca-tudo (ao abrir a caixa).
 * Nunca 500 por body adulterado. `Cache-Control: no-store`.
 */
export const runtime = 'nodejs'

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const viewerId = g.session.user.id

  // Parse tolerante: qualquer lixo → `ids` indefinido (marca-tudo). Nunca lança 500.
  let ids: string[] | undefined
  try {
    const body: unknown = await request.json()
    if (body && typeof body === 'object' && Array.isArray((body as { ids?: unknown }).ids)) {
      // Só strings entram; o filtro de uuid-válido é do markRead (defesa em profundidade).
      ids = ((body as { ids: unknown[] }).ids).filter((x): x is string => typeof x === 'string')
    }
  } catch {
    // body vazio/não-JSON → marca-tudo.
  }

  const result = await markRead(getDb(), viewerId, ids === undefined ? {} : { ids })
  return Response.json(result, { headers: { 'cache-control': 'no-store' } })
}
