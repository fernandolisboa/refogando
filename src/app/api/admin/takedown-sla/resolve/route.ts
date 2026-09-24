import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { normalizeTakedownResolution } from '@/domain/takedown'
import { resolveTakedownTicket } from '@/server/legal/takedown-resolve'

export const runtime = 'nodejs'

/** uuid canônico (a coluna `takedown_ticket.id` é uuid — um id inválido estouraria 22P02). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Encerra um ticket do painel de SLA de takedown — ADMIN-ONLY (`requireRole 'admin'`, mesma guarda do
 * `GET /api/admin/takedown-sla`; Curador/Usuário → 403, sem sessão → 401).
 *
 * Recebe `{ ticketId, resolution: 'fulfilled' | 'rejected', reason? }` (`reason` obrigatório na recusa).
 * 400 para corpo inválido, 404 para ticket inexistente, 409 se já encerrado, 200 `{ status }` no sucesso.
 * O status + o evento de auditoria (`DSAR_FULFILLED`/`DSAR_REJECTED`) gravam na mesma transação.
 */
export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    ticketId?: unknown
    resolution?: unknown
    reason?: unknown
  }
  const ticketId = typeof body.ticketId === 'string' ? body.ticketId.trim() : ''
  if (!UUID_RE.test(ticketId)) {
    return Response.json({ error: 'ticket_invalido' }, { status: 400 })
  }
  const v = normalizeTakedownResolution(body)
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 })

  const result = await resolveTakedownTicket(getDb(), {
    ticketId,
    actorId: g.session.user.id,
    resolution: v.value.resolution,
    reason: v.value.reason,
  })
  if (!result.ok) {
    return Response.json(
      { error: result.error },
      { status: result.error === 'not_found' ? 404 : 409 },
    )
  }
  return Response.json({ status: result.status })
}
