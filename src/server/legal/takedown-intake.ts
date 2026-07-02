import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import type { NormalizedTakedown } from '@/domain/takedown'
import { recordDsarEvent } from '@/server/legal/dsar-audit'

/**
 * Abre um ticket a partir do formulário PÚBLICO de intake (issue #399, GAP-2;
 * `docs/legal/takedown-e-remocao-titular.md` §2) e emite `DSAR_RECEIVED` na MESMA transação.
 *
 * Atomicidade (inegociável — ver `clearSourceAttribution`): ou grava-o-ticket-E-audita, ou nada. O
 * `received_at` do ticket é o início do SLA de 15 dias; o `DSAR_RECEIVED` marca esse mesmo instante na
 * trilha append-only. O `caseId` do evento aponta para o `id` do ticket (correlação recebido → …).
 *
 * `actorId: null` — o titular B (autor externo) NÃO tem conta; o pedido chega anônimo pelo `web_form`.
 * MINIMIZAÇÃO: os `details` do evento de auditoria NÃO copiam os dados do titular (URL/nome/pedido) —
 * eles vivem no ticket, que é a fonte para o operador agir. O evento carrega só a correlação (`caseId`).
 */
export async function createTakedownTicket(
  db: Database,
  input: NormalizedTakedown & { locale?: string | null },
): Promise<{ ticketId: string }> {
  const ticketId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(takedownTicket)
      .values({
        requestType: input.requestType,
        sourceUrl: input.sourceUrl,
        displayName: input.displayName,
        message: input.message,
        contactEmail: input.contactEmail,
        locale: input.locale ?? null,
        // status/received_at usam os defaults do schema ('received' / now()).
      })
      .returning({ id: takedownTicket.id })

    await recordDsarEvent(tx, {
      eventType: 'DSAR_RECEIVED',
      channel: 'web_form', // canal público do titular B (≠ 'self_service' do dono logado)
      requestType: input.requestType,
      caseId: row.id, // correlaciona o ciclo de vida do pedido com o ticket
      actorId: null, // titular B não tem conta — pedido anônimo
      // Só correlação/metadado NÃO-sensível; o dado do titular fica no ticket, não na auditoria.
    })

    return row.id
  })

  return { ticketId }
}
