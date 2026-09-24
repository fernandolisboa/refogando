/**
 * Kernel de domínio dos ALERTAS de SLA de pedidos do titular / takedown (issue #400, GAP-7 —
 * `docs/legal/takedown-e-remocao-titular.md` §3). PURO (sem DB, sem I/O, sem `Date.now()`): recebe o
 * `received_at` do ticket (início do SLA de 15 dias — Art. 19, II) e um "agora" INJETADO, e classifica o
 * nível de alerta pela IDADE em dias. Mesma forma dos demais kernels (`DSAR_EVENT_TYPES`,
 * `TAKEDOWN_REQUEST_TYPES`): array `as const` + tipo derivado + guard de borda.
 *
 * Níveis (limiares do §3), em ordem CRESCENTE de severidade (o índice no array É o rank):
 *  - `none`    — < 10 dias: sem alerta.
 *  - `yellow`  — ≥ 10 dias: o prazo se aproxima (alerta amarelo).
 *  - `red`     — ≥ 13 dias: escalonamento ao Encarregado (alerta vermelho).
 *  - `overdue` — ≥ 15 dias: limite VENCIDO — responder é obrigatório (mesmo que só andamento).
 *
 * O "alerta"/"escalonamento" é ESTADO gravado no ticket (coluna `sla_level`), NÃO envio de e-mail: não há
 * mailer nem canal ligado (o e-mail do Encarregado é placeholder, human-gated). A varredura só AVANÇA o
 * nível (`shouldEscalate`), nunca regride — daí a idempotência (não re-alerta o mesmo nível 2x).
 */

/** Dia (idade) a partir do qual cada nível vale. Limiares do §3 (10/13/15). */
export const SLA_YELLOW_DAY = 10
export const SLA_RED_DAY = 13
export const SLA_OVERDUE_DAY = 15

/** Níveis de alerta, ordenados por severidade crescente. O índice no array serve de rank comparável. */
export const SLA_LEVELS = ['none', 'yellow', 'red', 'overdue'] as const

export type SlaLevel = (typeof SLA_LEVELS)[number]

/** Guard de borda: um valor cru (da coluna `sla_level` do DB) é um `SlaLevel` conhecido? */
export function isSlaLevel(v: string): v is SlaLevel {
  return (SLA_LEVELS as readonly string[]).includes(v)
}

/** Rank comparável de um nível (índice no array; `none`=0 … `overdue`=3). PURO. */
export function slaLevelRank(level: SlaLevel): number {
  return SLA_LEVELS.indexOf(level)
}

const MS_PER_DAY = 86_400_000

/**
 * Dias COMPLETOS decorridos desde `received_at` até `now` (ambos injetados). Floor sobre a diferença em ms
 * → "N dias desde". Robusto a fuso: usa epoch (UTC), monotônico. Idade negativa (relógio adiantado /
 * `received_at` no futuro) cai em `none` no classificador (< 10).
 */
export function ticketAgeDays(receivedAt: Date, now: Date): number {
  return Math.floor((now.getTime() - receivedAt.getTime()) / MS_PER_DAY)
}

/** Classifica uma idade em dias no nível de alerta correspondente (limiares 10/13/15). PURO. */
export function slaLevelForAge(ageDays: number): SlaLevel {
  if (ageDays >= SLA_OVERDUE_DAY) return 'overdue'
  if (ageDays >= SLA_RED_DAY) return 'red'
  if (ageDays >= SLA_YELLOW_DAY) return 'yellow'
  return 'none'
}

/** Nível de alerta de um ticket a partir do seu `received_at` e do `now` injetado. PURO. */
export function slaLevelForTicket(receivedAt: Date, now: Date): SlaLevel {
  return slaLevelForAge(ticketAgeDays(receivedAt, now))
}

/**
 * Há uma transição a REGISTRAR? Só quando o nível computado é um AVANÇO sobre o já registrado — nunca
 * regride nem repete. É a garantia de idempotência da varredura: rodar de novo no mesmo "agora" vê
 * `next == current` → falso → não re-alerta.
 */
export function shouldEscalate(current: SlaLevel, next: SlaLevel): boolean {
  return slaLevelRank(next) > slaLevelRank(current)
}

/**
 * Status que ENCERRAM o ticket — o SLA para de correr, então ficam FORA da varredura de alertas. O ciclo
 * do operador (GAP-4) leva 'received' → 'verified' → 'fulfilled'/'rejected'; só os dois últimos resolvem.
 * Um ticket 'received' ou 'verified' segue ABERTO (prazo correndo).
 */
export const RESOLVED_TAKEDOWN_STATUSES = ['fulfilled', 'rejected'] as const
