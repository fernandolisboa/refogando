import { describe, expect, it } from 'vitest'
import { DATA_RETENTION_DAYS, retentionCutoffs } from '@/domain/data-retention'

/**
 * Prazos de retenção (#473, ADR-0050) — PURO, datas simuladas. O que importa é nunca apagar ANTES do prazo
 * de calendário: para toda data de criação `t`, `t + N dias` não pode cair antes de `t + período`.
 */

const DAY = 86_400_000

/** `t` + `months` meses de calendário (UTC; 29/02 + 12 meses cai em 01/03, o lado conservador). */
function addMonths(t: Date, months: number): Date {
  const d = new Date(t.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

/** Todo dia de 2024 a 2032 (três anos bissextos), às 13:37:42.123 UTC, mais as bordas de mês e de 29/02. */
function startDates(): Date[] {
  const out: Date[] = []
  for (let t = Date.UTC(2024, 0, 1, 13, 37, 42, 123); t < Date.UTC(2033, 0, 1); t += DAY) out.push(new Date(t))
  for (const iso of [
    '2024-02-29T00:00:00.000Z',
    '2024-02-29T23:59:59.999Z',
    '2028-02-29T12:00:00.000Z',
    '2027-03-01T00:00:00.000Z',
    '2025-01-31T23:59:59.999Z',
    '2025-12-31T23:59:59.999Z',
    '2026-08-31T00:00:00.000Z',
  ])
    out.push(new Date(iso))
  return out
}

describe('DATA_RETENTION_DAYS — nunca apaga antes do prazo de calendário', () => {
  const cases = [
    { key: 'usageLedger', months: 24, label: '24 meses' },
    { key: 'resolvedTakedown', months: 12, label: '12 meses' },
    { key: 'dsarAudit', months: 60, label: '5 anos' },
    { key: 'accountClosure', months: 60, label: '5 anos' },
  ] as const

  for (const { key, months, label } of cases) {
    it(`${key}: ${DATA_RETENTION_DAYS[key]} dias ≥ ${label} para toda data de partida`, () => {
      for (const t of startDates()) {
        const byDays = t.getTime() + DATA_RETENTION_DAYS[key] * DAY
        expect(byDays, t.toISOString()).toBeGreaterThanOrEqual(addMonths(t, months).getTime())
      }
    })

    it(`${key}: o corte de "agora" é exatamente ${DATA_RETENTION_DAYS[key]} dias antes, e a linha só sai depois`, () => {
      const t = new Date('2026-10-22T10:00:00.000Z')
      const due = new Date(t.getTime() + DATA_RETENTION_DAYS[key] * DAY)
      expect(retentionCutoffs(due)[key].getTime()).toBe(t.getTime())
      // Apaga-se o ANTERIOR ao corte: no instante exato do prazo, a linha ainda fica; 1 ms depois, sai.
      expect(t < retentionCutoffs(due)[key]).toBe(false)
      expect(t < retentionCutoffs(new Date(due.getTime() + 1))[key]).toBe(true)
    })
  }

  it('extractionEvent: 30 dias exatos', () => {
    const now = new Date('2026-10-22T10:00:00.000Z')
    expect(DATA_RETENTION_DAYS.extractionEvent).toBe(30)
    expect(retentionCutoffs(now).extractionEvent.toISOString()).toBe('2026-09-22T10:00:00.000Z')
  })

  it('os prazos de calendário não cabem em menos dias (o arredondamento é o mínimo para cima)', () => {
    // Algum `t` precisa dos 731/366/1827 dias inteiros: um dia a menos já apagaria cedo.
    for (const { key, months } of cases) {
      const tight = startDates().some(
        (t) => t.getTime() + (DATA_RETENTION_DAYS[key] - 1) * DAY < addMonths(t, months).getTime(),
      )
      expect(tight, key).toBe(true)
    }
  })
})
