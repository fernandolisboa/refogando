import { describe, it, expect } from 'vitest'
import {
  isSlaLevel,
  shouldEscalate,
  slaLevelForAge,
  slaLevelForTicket,
  slaLevelRank,
  ticketAgeDays,
} from '@/domain/dsar-sla'

/**
 * Kernel PURO dos alertas de SLA (#400, GAP-7) com DATAS SIMULADAS — sem DB, sem `Date.now()` (o "agora"
 * é injetado). Cobre os limiares 10/13/15 do §3, a monotonia do avanço (idempotência) e os guards.
 */

// "Agora" fixo de referência; recebimentos são derivados subtraindo dias inteiros.
const NOW = new Date('2026-07-01T09:00:00.000Z')
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('ticketAgeDays (dias completos desde received_at)', () => {
  it('conta dias completos por floor da diferença', () => {
    expect(ticketAgeDays(daysBefore(0), NOW)).toBe(0)
    expect(ticketAgeDays(daysBefore(10), NOW)).toBe(10)
    expect(ticketAgeDays(daysBefore(15), NOW)).toBe(15)
  })

  it('idade parcial arredonda para baixo (13d menos 1h ainda é 12)', () => {
    const recebido = new Date(NOW.getTime() - (13 * 86_400_000 - 3_600_000))
    expect(ticketAgeDays(recebido, NOW)).toBe(12)
  })

  it('received_at no futuro (relógio adiantado) → idade negativa', () => {
    expect(ticketAgeDays(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(-1)
  })
})

describe('slaLevelForAge (limiares 10/13/15 do §3)', () => {
  it('< 10 dias → none', () => {
    expect(slaLevelForAge(0)).toBe('none')
    expect(slaLevelForAge(9)).toBe('none')
    expect(slaLevelForAge(-1)).toBe('none') // idade negativa não alerta
  })

  it('≥ 10 e < 13 → yellow (prazo se aproxima)', () => {
    expect(slaLevelForAge(10)).toBe('yellow')
    expect(slaLevelForAge(12)).toBe('yellow')
  })

  it('≥ 13 e < 15 → red (escalonamento ao Encarregado)', () => {
    expect(slaLevelForAge(13)).toBe('red')
    expect(slaLevelForAge(14)).toBe('red')
  })

  it('≥ 15 → overdue (limite vencido)', () => {
    expect(slaLevelForAge(15)).toBe('overdue')
    expect(slaLevelForAge(30)).toBe('overdue')
  })
})

describe('slaLevelForTicket (received_at + now injetados)', () => {
  it('classifica pelo received_at simulado', () => {
    expect(slaLevelForTicket(daysBefore(5), NOW)).toBe('none')
    expect(slaLevelForTicket(daysBefore(10), NOW)).toBe('yellow')
    expect(slaLevelForTicket(daysBefore(13), NOW)).toBe('red')
    expect(slaLevelForTicket(daysBefore(20), NOW)).toBe('overdue')
  })
})

describe('shouldEscalate (só avança — base da idempotência)', () => {
  it('avança quando o nível computado é mais severo', () => {
    expect(shouldEscalate('none', 'yellow')).toBe(true)
    expect(shouldEscalate('yellow', 'red')).toBe(true)
    expect(shouldEscalate('red', 'overdue')).toBe(true)
    expect(shouldEscalate('none', 'overdue')).toBe(true) // salto direto (cron não rodou por dias)
  })

  it('NÃO re-alerta o mesmo nível (idempotência)', () => {
    expect(shouldEscalate('yellow', 'yellow')).toBe(false)
    expect(shouldEscalate('overdue', 'overdue')).toBe(false)
  })

  it('NUNCA regride', () => {
    expect(shouldEscalate('red', 'yellow')).toBe(false)
    expect(shouldEscalate('overdue', 'none')).toBe(false)
  })
})

describe('rank e guard de borda', () => {
  it('rank cresce com a severidade', () => {
    expect(slaLevelRank('none')).toBeLessThan(slaLevelRank('yellow'))
    expect(slaLevelRank('yellow')).toBeLessThan(slaLevelRank('red'))
    expect(slaLevelRank('red')).toBeLessThan(slaLevelRank('overdue'))
  })

  it('isSlaLevel aceita só os níveis conhecidos', () => {
    expect(isSlaLevel('yellow')).toBe(true)
    expect(isSlaLevel('overdue')).toBe(true)
    expect(isSlaLevel('verde')).toBe(false)
    expect(isSlaLevel('')).toBe(false)
  })
})
