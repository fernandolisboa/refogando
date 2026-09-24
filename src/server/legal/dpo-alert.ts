import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import type { Mailer } from '@/server/mail/mailer'
import { RESOLVED_TAKEDOWN_STATUSES, ticketAgeDays } from '@/domain/dsar-sla'

/**
 * Alerta POR E-MAIL ao Encarregado (DPO) dos tickets em nível CRÍTICO de SLA (#413; GAP-7,
 * `docs/legal/takedown-e-remocao-titular.md` §3). Complementa `scanDsarSla`: aquele AVANÇA o `sla_level`
 * gravado (estado queryável); este NOTIFICA quando o nível já é 'red' (≥13d, escalonamento) ou 'overdue'
 * (≥15d, vencido) e o alerta AINDA NÃO foi enviado.
 *
 * IDEMPOTÊNCIA por `dpo_notified_at` (coluna SEPARADA de `sla_alerted_at`): só notifica tickets com
 * `dpo_notified_at IS NULL`, e só carimba a coluna APÓS o provedor confirmar o envio (`sent === true`).
 * Falha de envio ⇒ segue nulo ⇒ reenvia na próxima varredura (amanhã). Rodar de novo no mesmo dia não
 * re-notifica os já carimbados.
 *
 * Ordem inegociável: o `fetch` do e-mail acontece FORA de qualquer transação (o mailer é rede — nunca
 * segurar conexão/lock de DB esperando I/O externo). Loop simples: envia → se aceito, UPDATE do carimbo.
 *
 * Destinatário = `DSAR_DPO_EMAIL` (o e-mail do Encarregado). Ausente ⇒ NO-OP (não há para quem alertar;
 * fail-closed, sem tocar o DB de escrita nem a rede).
 */

/** Níveis de SLA que disparam alerta ao Encarregado (escalonamento em diante). */
const ALERTING_SLA_LEVELS = ['red', 'overdue'] as const

export type DpoAlertResult = {
  /** Tickets efetivamente notificados (e carimbados) nesta passada. */
  notified: number
}

export async function notifyDpoRedTickets(
  db: Database,
  mailer: Mailer,
  now: Date,
): Promise<DpoAlertResult> {
  const to = process.env.DSAR_DPO_EMAIL
  // Sem destinatário configurado ⇒ nada a fazer (não há Encarregado para alertar). NÃO toca a rede.
  if (!to) return { notified: 0 }

  // Tickets em nível crítico, AINDA abertos e NÃO notificados. `dpo_notified_at IS NULL` é a guarda de
  // idempotência (já-notificados não voltam).
  const pending = await db
    .select({
      id: takedownTicket.id,
      requestType: takedownTicket.requestType,
      receivedAt: takedownTicket.receivedAt,
      slaLevel: takedownTicket.slaLevel,
    })
    .from(takedownTicket)
    .where(
      and(
        inArray(takedownTicket.slaLevel, [...ALERTING_SLA_LEVELS]),
        notInArray(takedownTicket.status, [...RESOLVED_TAKEDOWN_STATUSES]),
        isNull(takedownTicket.dpoNotifiedAt),
      ),
    )

  let notified = 0
  for (const t of pending) {
    const ageDays = ticketAgeDays(t.receivedAt, now)
    const { sent } = await mailer.sendDpoAlert({
      to,
      subject: dpoAlertSubject(t.slaLevel),
      text: dpoAlertText({ id: t.id, requestType: t.requestType, ageDays, slaLevel: t.slaLevel }),
    })
    if (!sent) continue // provedor não aceitou ⇒ segue nulo ⇒ reenvia amanhã

    // Carimba SÓ após envio confirmado, guardado por `IS NULL` (não re-carimba sob corrida).
    await db
      .update(takedownTicket)
      .set({ dpoNotifiedAt: now })
      .where(and(eq(takedownTicket.id, t.id), isNull(takedownTicket.dpoNotifiedAt)))
    notified += 1
  }

  return { notified }
}

/** Assunto curto, SEM PII de terceiros — só a severidade. */
function dpoAlertSubject(slaLevel: string): string {
  const venc = slaLevel === 'overdue' ? 'VENCIDO' : 'escalonamento'
  return `[Refogando] Alerta de SLA (${venc}) — pedido de remoção`
}

/**
 * Corpo em texto puro. Só o NECESSÁRIO para agir: protocolo (id do ticket), idade, tipo e nível. Evita
 * PII de terceiros (nome/URL/mensagem do titular ficam no ticket, acessível ao operador via /admin).
 */
function dpoAlertText(input: {
  id: string
  requestType: string
  ageDays: number
  slaLevel: string
}): string {
  const linha = input.slaLevel === 'overdue' ? 'PRAZO VENCIDO' : 'prazo próximo (escalonamento)'
  return [
    `Um pedido de remoção/DSAR precisa de atenção (${linha}).`,
    '',
    `Protocolo: ${input.id}`,
    `Tipo: ${input.requestType}`,
    `Idade: ${input.ageDays} dias`,
    `Nível de SLA: ${input.slaLevel}`,
    '',
    'Acesse o painel administrativo para ver os detalhes e responder.',
  ].join('\n')
}
