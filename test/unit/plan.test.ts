import { describe, expect, it } from 'vitest'
import { PLANS, isPlan, DEFAULT_PLAN, type Plan } from '@/domain/plan'

/**
 * Eixo `plan` (#466, scaffold de paywall flag-off) — kernel PURO. Mesma forma de `user.ts` (ROLES):
 * array `as const` + guard + default. O default é `free` (scaffold flag-off = comportamento atual).
 */
describe('plan — eixo comercial de entitlement', () => {
  it('PLANS é exatamente [free, pro]', () => {
    expect(PLANS).toEqual(['free', 'pro'])
  })

  it('DEFAULT_PLAN é free (flag-off = comportamento atual)', () => {
    expect(DEFAULT_PLAN).toBe('free')
  })

  it('isPlan aceita free/pro e rejeita o resto (fail-safe na borda)', () => {
    expect(isPlan('free')).toBe(true)
    expect(isPlan('pro')).toBe(true)
    expect(isPlan('admin')).toBe(false)
    expect(isPlan('')).toBe(false)
    expect(isPlan('FREE')).toBe(false)
  })

  it('o tipo Plan cobre só os dois valores (compila)', () => {
    const p: Plan = 'pro'
    expect(PLANS).toContain(p)
  })
})
