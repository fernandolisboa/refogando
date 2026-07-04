import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import type { NormalizedTakedown } from '@/domain/takedown'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import { getMailer } from '@/server/deps'

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

  // Best-effort: avisa o Encarregado da CHEGADA de um novo ticket. FORA da transação (o mailer é rede) e
  // à prova de falha — e-mail que não sai NÃO pode quebrar a criação do ticket (o intake já está gravado e
  // auditado; o cron de SLA cobre o alerta crítico de qualquer forma). No-op sem credencial/destinatário.
  const to = process.env.DSAR_DPO_EMAIL
  if (to) {
    try {
      await getMailer().sendDpoAlert({
        to,
        subject: '[Refogando] Novo pedido de remoção recebido',
        text: [
          'Um novo pedido de remoção/DSAR foi recebido pelo formulário público.',
          '',
          `Protocolo: ${ticketId}`,
          `Tipo: ${input.requestType}`,
          '',
          'Acesse o painel administrativo para ver os detalhes e responder.',
        ].join('\n'),
      })
    } catch {
      // Falha de e-mail é silenciada — o ticket já existe; o SLA/cron garante o follow-up.
    }
  }

  return { ticketId }
}
