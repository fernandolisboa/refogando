import { and, eq, notInArray } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { takedownTicket } from '@/db/schema'
import {
  isSlaLevel,
  RESOLVED_TAKEDOWN_STATUSES,
  shouldEscalate,
  slaLevelForAge,
  ticketAgeDays,
  type SlaLevel,
} from '@/domain/dsar-sla'

/**
 * Varredura de SLA dos pedidos do titular / takedown (issue #400, GAP-7; `docs/legal/takedown-e-remocao-
 * titular.md` §3). Percorre os tickets ABERTOS (status não-resolvido) e AVANÇA a coluna `sla_level` de
 * cada um para o nível que a IDADE (dias desde `received_at`) exige — quando isso é um avanço.
 *
 * `now` é INJETADO (o kernel `@/domain/dsar-sla` é puro/testável com datas simuladas; a rota de cron passa
 * `new Date()`). IDEMPOTENTE: rodar de novo no mesmo "agora" não muda nada (o nível já registrado == o
 * computado → `shouldEscalate` falso). O "alerta"/"escalonamento" é ESTADO gravado (queryável por
 * `sla_level` = 'red'/'overdue'), NÃO envio de e-mail — não há mailer/canal ligado (human-gated).
 */

export type SlaTransition = {
  ticketId: string
  from: SlaLevel
  to: SlaLevel
  ageDays: number
}

export type SlaScanResult = {
  /** Tickets abertos varridos nesta passada. */
  scanned: number
  /** Transições de nível REGISTRADAS nesta passada (vazio quando nada avançou — idempotência). */
  transitions: SlaTransition[]
}

export async function scanDsarSla(db: Database, now: Date): Promise<SlaScanResult> {
  const open = await db
    .select({
      id: takedownTicket.id,
      receivedAt: takedownTicket.receivedAt,
      slaLevel: takedownTicket.slaLevel,
    })
    .from(takedownTicket)
    // Tickets ABERTOS: status fora do conjunto que encerra (fulfilled/rejected). Spread p/ array mutável.
    .where(notInArray(takedownTicket.status, [...RESOLVED_TAKEDOWN_STATUSES]))

  const transitions: SlaTransition[] = []
  for (const t of open) {
    const ageDays = ticketAgeDays(t.receivedAt, now)
    const next = slaLevelForAge(ageDays)
    const current: SlaLevel = isSlaLevel(t.slaLevel) ? t.slaLevel : 'none'
    if (!shouldEscalate(current, next)) continue

    // UPDATE guardado pelo nível ATUAL: se uma execução concorrente já avançou este ticket, o WHERE não
    // casa e a atualização é no-op (idempotência sob corrida — o cron diário não deve sobrepor, mas a
    // guarda é barata). Avançamos DIRETO para o nível da idade (não reprisamos os intermediários).
    await db
      .update(takedownTicket)
      .set({ slaLevel: next, slaAlertedAt: now })
      .where(and(eq(takedownTicket.id, t.id), eq(takedownTicket.slaLevel, current)))

    transitions.push({ ticketId: t.id, from: current, to: next, ageDays })
  }

  return { scanned: open.length, transitions }
}
