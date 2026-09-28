import { describe, it, expect } from 'vitest'
import { capitalizeFirst, slotForNow } from '@/components/meal-plan/meal-plan-format'

describe('slotForNow — refeição padrão pela hora LOCAL (ADR-0035 dec.4)', () => {
  it.each([
    [6, 'cafe_da_manha'],
    [9, 'cafe_da_manha'],
    [10, 'almoco'],
    [14, 'almoco'],
    [15, 'lanche'],
    [17, 'lanche'],
    [18, 'jantar'],
    [23, 'jantar'],
  ] as const)('%ih ⇒ %s', (hour, slot) => {
    expect(slotForNow(new Date(2026, 8, 30, hour, 30))).toBe(slot)
  })
})

describe('capitalizeFirst', () => {
  it('só a primeira letra (CSS capitalize faria "Segunda-Feira")', () => {
    expect(capitalizeFirst('segunda-feira')).toBe('Segunda-feira')
    expect(capitalizeFirst('')).toBe('')
  })
})
