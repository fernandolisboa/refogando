import { describe, it, expect } from 'vitest'
import { DAILY_WEB_SEARCH_QUERY_CAP, utcDayKey } from '@/domain/web-search-budget'

/**
 * Teto de GASTO da descoberta na web (#464) — parte PURA: a chave de dia UTC e a sanidade do teto.
 * A reserva atômica (SQL) é coberta pela integração (`discovery-web.test.ts`).
 */
describe('web-search-budget (#464)', () => {
  it('utcDayKey: YYYY-MM-DD em UTC (independe do fuso local)', () => {
    // 23:30 UTC e 00:30 UTC do dia seguinte caem em dias DIFERENTES (a virada é em UTC).
    expect(utcDayKey(new Date('2026-07-05T23:30:00.000Z'))).toBe('2026-07-05')
    expect(utcDayKey(new Date('2026-07-06T00:30:00.000Z'))).toBe('2026-07-06')
  })

  it('utcDayKey: instante no fim do dia em fuso local mas ainda no MESMO dia UTC não vira', () => {
    // Meia-noite exata UTC ⇒ já é o novo dia.
    expect(utcDayKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01')
    expect(utcDayKey(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31')
  })

  it('teto é um inteiro positivo folgado (disjuntor de custo, não uso normal)', () => {
    expect(Number.isInteger(DAILY_WEB_SEARCH_QUERY_CAP)).toBe(true)
    expect(DAILY_WEB_SEARCH_QUERY_CAP).toBeGreaterThan(0)
  })
})
