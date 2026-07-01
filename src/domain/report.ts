/**
 * Report + estado de resolução — kernel de domínio (issue #18, ADR-0003/0011).
 *
 * Mesma forma de `user.ts`/`recipe.ts`: array `as const` + tipo derivado + guard puro.
 * `schema.ts` mapeia `REPORT_STATUSES` para `pgEnum('report_status')`. Um Report mira a
 * RECEITA (não a tradução): a moderação tem identidade única entre locales (AC4).
 *
 *  - `pending`  — entrou na fila do Curador, ainda não decidido.
 *  - `resolved` — Curador removeu a Receita do pool (registrando o motivo).
 *  - `rejected` — Curador manteve a Receita no pool (keep).
 */
export const REPORT_STATUSES = ['pending', 'resolved', 'rejected'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export function isReportStatus(v: string): v is ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(v)
}

/**
 * Validador PURO do motivo (AC2: o Curador remove do pool REGISTRANDO O MOTIVO; o mesmo
 * motivo obrigatório vale para criar um Report). Espelha o padrão `decide*` de
 * `recipe-visibility.ts`: decisão pura, zero DB/I/O. Único validador de motivo,
 * reusado por `createReport` E por `applyModerationRemove` — o motivo nunca é opcional.
 */
export function decideModerationReason(input: { reason: string }): { allowed: boolean } {
  return { allowed: input.reason.trim().length > 0 }
}
