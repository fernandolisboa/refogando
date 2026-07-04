import { describe, expect, it } from 'vitest'
import { anonymizedAgeDays, isPastRetention, RETENTION_DAYS } from '@/domain/account-purge'

/**
 * Kernel PURO do expurgo físico pós-retenção (#411) com DATAS SIMULADAS — sem DB, sem `Date.now()` (o
 * "agora" é injetado). Cobre o limiar de retenção (180 default), a monotonia da idade e a borda futura.
 */

const NOW = new Date('2026-07-01T09:00:00.000Z')
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('anonymizedAgeDays (dias completos desde anonymized_at)', () => {
  it('conta dias completos por floor da diferença', () => {
    expect(anonymizedAgeDays(daysBefore(0), NOW)).toBe(0)
    expect(anonymizedAgeDays(daysBefore(180), NOW)).toBe(180)
    expect(anonymizedAgeDays(daysBefore(365), NOW)).toBe(365)
  })

  it('anonymized_at no futuro (relógio adiantado) → idade negativa', () => {
    expect(anonymizedAgeDays(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(-1)
  })
})

describe('isPastRetention (limiar de 180 dias, default conservador)', () => {
  it('DENTRO da retenção → false (não expurga cedo)', () => {
    expect(isPastRetention(daysBefore(0), NOW)).toBe(false)
    expect(isPastRetention(daysBefore(RETENTION_DAYS - 1), NOW)).toBe(false)
  })

  it('exatamente no limiar (≥ 180) → true', () => {
    expect(isPastRetention(daysBefore(RETENTION_DAYS), NOW)).toBe(true)
  })

  it('bem além da retenção → true', () => {
    expect(isPastRetention(daysBefore(400), NOW)).toBe(true)
  })

  it('idade negativa (anonymized_at no futuro) → false', () => {
    expect(isPastRetention(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(false)
  })

  it('retentionDays sobrescrito (env do server) desloca o limiar', () => {
    // Com retenção de 30 dias, uma conta de 60 dias JÁ passou; com 90, ainda não.
    expect(isPastRetention(daysBefore(60), NOW, 30)).toBe(true)
    expect(isPastRetention(daysBefore(60), NOW, 90)).toBe(false)
  })
})
