import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import type { NormalizedTakedown } from '@/domain/takedown'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import { getMailer } from '@/server/deps'
import { GLOBAL_LIMIT_KEY } from '@/domain/rate-limit-rules'
import { errorLogFields } from '@/domain/error-report'
import { consumeRateLimit } from '@/server/rate-limit/window'

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
  // auditado). No-op sem destinatário.
  //
  // #648 (ADR-0057): no máximo `RATE_LIMITS.dpo_email` e-mails por hora ao Encarregado, somando todas as instâncias
  // (o Resend é a mesma cota dos e-mails de cadastro e de senha). Acima do teto, ou se o envio falhar, o ticket fica
  // com `dpo_arrival_notified_at` nulo e entra no RESUMO DIÁRIO do cron `dsar-sla` (`notifyDpoDigest`); ele também
  // aparece na hora no painel de SLA do /admin. Nenhum pedido fica sem aviso: só o e-mail individual é poupado.
  const to = process.env.DSAR_DPO_EMAIL
  if (to) await notifyArrival(db, to, ticketId, input.requestType)

  return { ticketId }
}

/** E-mail individual de chegada, dentro do teto por hora; carimba `dpo_arrival_notified_at` se o provedor aceitou. */
async function notifyArrival(db: Database, to: string, ticketId: string, requestType: string): Promise<void> {
  try {
    const cap = await consumeRateLimit(db, { bucket: 'dpo_email', key: GLOBAL_LIMIT_KEY })
    if (!cap.allowed) {
      // Sem id nem dado do titular: o ticket está no painel e no resumo diário.
      console.info('[takedown] e-mail de chegada adiado para o resumo diário: motivo=teto_por_hora')
      return
    }
    const { sent } = await getMailer().sendDpoAlert({
      to,
      subject: '[Refogando] Novo pedido de remoção recebido',
      text: [
        'Um novo pedido de remoção/DSAR foi recebido pelo formulário público.',
        '',
        `Protocolo: ${ticketId}`,
        `Tipo: ${requestType}`,
        '',
        'Acesse o painel administrativo para ver os detalhes e responder.',
      ].join('\n'),
    })
    if (!sent) return // segue nulo ⇒ entra no resumo diário
    await db
      .update(takedownTicket)
      .set({ dpoArrivalNotifiedAt: new Date() })
      .where(and(eq(takedownTicket.id, ticketId), isNull(takedownTicket.dpoArrivalNotifiedAt)))
  } catch (err) {
    // Falha do teto ou do carimbo é engolida — o ticket já existe; o resumo diário cobre o aviso.
    console.warn(`[takedown] e-mail de chegada não confirmado: ${errorLogFields(err)}`)
  }
}
