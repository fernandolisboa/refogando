import { desc, notInArray } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { takedownTicket } from '@/db/schema'
import { RESOLVED_TAKEDOWN_STATUSES } from '@/domain/dsar-sla'

export const runtime = 'nodejs'

/**
 * Painel de SLA de takedown (#412) — ADMIN-ONLY (`requireRole 'admin'`; Curador/Usuário → 403, sem
 * sessão → 401, mesma guarda de `/api/admin/config`). Lista os tickets de takedown/DSAR ABERTOS —
 * aqueles cujo SLA de 15 dias (Art. 19, II) AINDA corre — em ordem do mais recente por recebimento;
 * a UI reordena por urgência (rank do sla_level), para o operador acompanhar prazos e escalonar.
 *
 * FILTRO INEGOCIÁVEL: exclui os status que ENCERRAM o ticket (`RESOLVED_TAKEDOWN_STATUSES` =
 * fulfilled/rejected — fonte única em `src/domain/dsar-sla.ts`, NUNCA hardcode). Um ticket resolvido
 * RETÉM o `sla_level` alto que tinha ao ser encerrado (a varredura só avança, nunca zera), então
 * incluí-lo pintaria alertas vermelhos de prazos que já não correm — por isso ele NÃO pode aparecer.
 *
 * Só metadados queryáveis vão no SELECT (sem PII além do já exibido no ticket); o `sla_level` cru
 * viaja e a UI o traduz/ranqueia. Read-only: sem mutação, sem auditoria.
 */
export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'admin')
  if (!g.ok) return g.response

  const tickets = await getDb()
    .select({
      id: takedownTicket.id,
      requestType: takedownTicket.requestType,
      sourceUrl: takedownTicket.sourceUrl,
      displayName: takedownTicket.displayName,
      message: takedownTicket.message,
      receivedAt: takedownTicket.receivedAt,
      slaLevel: takedownTicket.slaLevel,
    })
    .from(takedownTicket)
    .where(notInArray(takedownTicket.status, [...RESOLVED_TAKEDOWN_STATUSES]))
    .orderBy(desc(takedownTicket.receivedAt))

  return Response.json({ tickets })
}
