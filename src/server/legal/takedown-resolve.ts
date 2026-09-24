import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import { RESOLVED_TAKEDOWN_STATUSES } from '@/domain/dsar-sla'
import type { TakedownResolution } from '@/domain/takedown'
import { recordDsarEvent } from '@/server/legal/dsar-audit'

/**
 * ENCERRA um ticket de takedown pelo operador (`docs/legal/takedown-e-remocao-titular.md` §4.2, passo 6).
 * Fecha o ciclo que o intake (#399) abre: sem isto, todo ticket ficava "aberto" para sempre e o painel de
 * SLA + o cron continuavam alertando prazos de pedidos já respondidos.
 *
 * Atomicidade (mesma regra do intake): muda o `status` E grava o evento de auditoria na MESMA transação,
 * ou nada. O ticket é travado com `FOR UPDATE` — dois cliques/abas concorrentes não geram dois eventos.
 *
 *  - `fulfilled` → `DSAR_FULFILLED`. O CHECK `dsar_fulfilled_hash_chk` exige hash: o payload hasheado é o
 *    que o titular pediu (nome exibido + URL do ticket) — prova sem re-armazenar em claro. `recipeIds`
 *    vazio: as remoções efetivas, se houve, já foram auditadas pelas rotas de atribuição com o `caseId`.
 *  - `rejected`  → `DSAR_REJECTED` com o motivo.
 *
 * `caseId` = id do ticket (mesma correlação do `DSAR_RECEIVED`). Ticket inexistente → `not_found`;
 * já encerrado → `already_resolved` (sem novo evento — a trilha não ganha um 2º desfecho).
 */
export type ResolveTakedownResult =
  | { ok: true; status: TakedownResolution }
  | { ok: false; error: 'not_found' | 'already_resolved' }

export async function resolveTakedownTicket(
  db: Database,
  input: {
    ticketId: string
    actorId: string
    resolution: TakedownResolution
    reason: string | null
    now?: Date
  },
): Promise<ResolveTakedownResult> {
  return db.transaction(async (tx) => {
    const [ticket] = await tx
      .select({
        id: takedownTicket.id,
        status: takedownTicket.status,
        requestType: takedownTicket.requestType,
        sourceUrl: takedownTicket.sourceUrl,
        displayName: takedownTicket.displayName,
      })
      .from(takedownTicket)
      .where(eq(takedownTicket.id, input.ticketId))
      .for('update')

    if (!ticket) return { ok: false, error: 'not_found' } as const
    if ((RESOLVED_TAKEDOWN_STATUSES as readonly string[]).includes(ticket.status)) {
      return { ok: false, error: 'already_resolved' } as const
    }

    await tx
      .update(takedownTicket)
      .set({ status: input.resolution })
      .where(eq(takedownTicket.id, ticket.id))

    if (input.resolution === 'fulfilled') {
      await recordDsarEvent(tx, {
        eventType: 'DSAR_FULFILLED',
        caseId: ticket.id,
        actorId: input.actorId,
        requestType: ticket.requestType,
        fulfillment: {
          recipeIds: [],
          removedSourceName: ticket.displayName ?? '',
          ...(ticket.sourceUrl !== null ? { removedSourceUrl: ticket.sourceUrl } : {}),
          ts: (input.now ?? new Date()).toISOString(),
        },
        details: { closedTicket: true },
      })
    } else {
      await recordDsarEvent(tx, {
        eventType: 'DSAR_REJECTED',
        caseId: ticket.id,
        actorId: input.actorId,
        requestType: ticket.requestType,
        reason: input.reason ?? '',
      })
    }

    return { ok: true, status: input.resolution } as const
  })
}
