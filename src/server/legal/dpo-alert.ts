import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import type { Mailer } from '@/server/mail/mailer'
import { RESOLVED_TAKEDOWN_STATUSES, ticketAgeDays } from '@/domain/dsar-sla'
import { GLOBAL_LIMIT_KEY } from '@/domain/rate-limit-rules'
import { consumeRateLimit } from '@/server/rate-limit/window'

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
 *
 * #648 (ADR-0057): cada e-mail POR TICKET gasta uma unidade do teto `dpo_email` (por hora, somando o aviso de
 * chegada do intake). Uma enxurrada de tickets falsos chegaria ao vermelho no mesmo dia e mandaria um e-mail por
 * ticket de uma vez, gastando a cota do Resend dos e-mails de conta. Teto estourado ⇒ para de enviar nesta passada;
 * os que sobraram seguem com `dpo_notified_at` nulo e entram no resumo (`notifyDpoDigest`), que roda logo depois no
 * mesmo cron, e voltam amanhã.
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
    const cap = await consumeRateLimit(db, { bucket: 'dpo_email', key: GLOBAL_LIMIT_KEY }, now)
    if (!cap.allowed) break // o resumo diário lista os que ficaram
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

/** Quantos protocolos o resumo lista por categoria (o total vai sempre; o resto está no painel de SLA). */
export const DPO_DIGEST_MAX_LISTED = 20

export type DpoDigestResult = {
  /** O resumo foi aceito pelo provedor nesta passada. */
  sent: boolean
  /** Tickets abertos ainda sem aviso de chegada (teto do intake ou envio que falhou), carimbados se `sent`. */
  arrivals: number
  /** Tickets em vermelho/vencido ainda sem alerta individual (teto por hora). Seguem nulos: voltam amanhã. */
  redPending: number
}

/**
 * RESUMO DIÁRIO ao Encarregado (#648, ADR-0057), no cron `dsar-sla`, depois de `notifyDpoRedTickets`. Um e-mail só,
 * FORA do teto por hora, e só quando há algo que o teto (ou uma falha de envio) segurou:
 *  - tickets ABERTOS com `dpo_arrival_notified_at` nulo (sem aviso de chegada);
 *  - tickets ABERTOS em 'red'/'overdue' com `dpo_notified_at` nulo (sem alerta individual).
 * Traz os totais e até `DPO_DIGEST_MAX_LISTED` protocolos de cada, os mais antigos primeiro (prazo mais curto). Aceito
 * pelo provedor ⇒ carimba `dpo_arrival_notified_at` dos de chegada (já avisados). Os vermelhos NÃO são carimbados:
 * o alerta individual é o deles, e enquanto ele não sai o ticket volta no resumo de amanhã. Nada aceito ⇒ nada
 * carimbado, e tudo volta amanhã. Mesmo sem e-mail, todo ticket aberto aparece no painel de SLA do /admin.
 *
 * Mesma minimização do alerta: protocolo, tipo, data e nível; nunca nome, URL, mensagem ou contato do titular.
 */
export async function notifyDpoDigest(db: Database, mailer: Mailer, now: Date): Promise<DpoDigestResult> {
  const to = process.env.DSAR_DPO_EMAIL
  if (!to) return { sent: false, arrivals: 0, redPending: 0 }

  const open = notInArray(takedownTicket.status, [...RESOLVED_TAKEDOWN_STATUSES])
  const cols = {
    id: takedownTicket.id,
    requestType: takedownTicket.requestType,
    receivedAt: takedownTicket.receivedAt,
    slaLevel: takedownTicket.slaLevel,
  }
  const arrivals = await db
    .select(cols)
    .from(takedownTicket)
    .where(and(open, isNull(takedownTicket.dpoArrivalNotifiedAt)))
    .orderBy(asc(takedownTicket.receivedAt))
  const red = await db
    .select(cols)
    .from(takedownTicket)
    .where(
      and(open, inArray(takedownTicket.slaLevel, [...ALERTING_SLA_LEVELS]), isNull(takedownTicket.dpoNotifiedAt)),
    )
    .orderBy(asc(takedownTicket.receivedAt))
  if (arrivals.length === 0 && red.length === 0) return { sent: false, arrivals: 0, redPending: 0 }

  const line = (t: (typeof arrivals)[number]) =>
    `- ${t.id} — ${t.requestType} — recebido em ${t.receivedAt.toISOString().slice(0, 10)} (${ticketAgeDays(t.receivedAt, now)} dias) — SLA ${t.slaLevel}`
  const section = (title: string, rows: typeof arrivals): string[] =>
    rows.length === 0
      ? []
      : [
          `${title}: ${rows.length}`,
          ...rows.slice(0, DPO_DIGEST_MAX_LISTED).map(line),
          ...(rows.length > DPO_DIGEST_MAX_LISTED ? [`… e mais ${rows.length - DPO_DIGEST_MAX_LISTED} no painel.`] : []),
          '',
        ]

  const { sent } = await mailer.sendDpoAlert({
    to,
    subject: `[Refogando] Resumo diário: ${arrivals.length + red.length} pedido(s) de remoção sem e-mail individual`,
    text: [
      'Estes pedidos de remoção/DSAR não tiveram e-mail individual (teto de e-mails por hora ou falha de envio).',
      'O prazo legal de 15 dias corre desde o recebimento.',
      '',
      ...section('Recebidos sem aviso de chegada', arrivals),
      ...section('Em escalonamento ou vencidos sem alerta individual', red),
      'Acesse o painel administrativo (SLA dos pedidos de takedown) para ver todos e responder.',
    ].join('\n'),
  })
  if (!sent) return { sent: false, arrivals: arrivals.length, redPending: red.length }

  if (arrivals.length > 0) {
    await db
      .update(takedownTicket)
      .set({ dpoArrivalNotifiedAt: now })
      .where(
        and(
          inArray(
            takedownTicket.id,
            arrivals.map((t) => t.id),
          ),
          isNull(takedownTicket.dpoArrivalNotifiedAt),
        ),
      )
  }
  return { sent: true, arrivals: arrivals.length, redPending: red.length }
}
