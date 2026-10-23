/**
 * Prazos de retenção dos dados que o app apaga sozinho (issue #473, ADR-0050; `docs/legal/registro-de-
 * operacoes.md`; `docs/legal/parecer-interno-2026-10-22.md` §5). PURO (sem DB, sem `Date.now()`): o cron de
 * retenção (`/api/cron/retention`) injeta o "agora" e apaga o que é MAIS VELHO que o corte.
 *
 * Os prazos legais são de calendário (24 meses, 12 meses, 5 anos); aqui viram DIAS arredondados PARA CIMA,
 * para nada sair antes do prazo em nenhuma data de partida: 24 meses têm no máximo 731 dias, 12 meses no
 * máximo 366 e 5 anos no máximo 1827 (um ou dois 29 de fevereiro no meio). O preço é guardar até 2 dias a
 * mais. Os 30 dias da extração são exatos (o prazo já é em dias).
 */

export const DATA_RETENTION_DAYS = {
  /** Registros de uso de IA (`image_generation`, `meal_plan_suggestion_event`, tokens e custo de `generation`): 24 meses. */
  usageLedger: 731,
  /** `extraction_event`: só alimenta uma cota de 24 h. */
  extractionEvent: 30,
  /** Ticket de takedown/DSAR encerrado: 12 meses depois do encerramento. */
  resolvedTakedown: 366,
  /** Auditoria DSAR: 5 anos (Lei 9.873/1999, art. 1º). */
  dsarAudit: 1827,
  /**
   * Registro do encerramento de conta pela equipe (`account_closure`, #606): 5 anos, para a defesa num eventual
   * processo (o prazo da reparação do CDC, art. 27, e o da ação punitiva da administração, Lei 9.873/1999, art. 1º).
   */
  accountClosure: 1827,
} as const

export type RetentionCutoffs = { [K in keyof typeof DATA_RETENTION_DAYS]: Date }

const MS_PER_DAY = 86_400_000

/** Cortes de cada prazo: apaga-se o que for ANTERIOR (`<`) ao corte. PURO. */
export function retentionCutoffs(now: Date): RetentionCutoffs {
  const before = (days: number) => new Date(now.getTime() - days * MS_PER_DAY)
  return {
    usageLedger: before(DATA_RETENTION_DAYS.usageLedger),
    extractionEvent: before(DATA_RETENTION_DAYS.extractionEvent),
    resolvedTakedown: before(DATA_RETENTION_DAYS.resolvedTakedown),
    dsarAudit: before(DATA_RETENTION_DAYS.dsarAudit),
    accountClosure: before(DATA_RETENTION_DAYS.accountClosure),
  }
}
