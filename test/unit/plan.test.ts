import { describe, expect, it } from 'vitest'
import { PLANS, isPlan, DEFAULT_PLAN, isFreePlanUser, type Plan } from '@/domain/plan'

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

/**
 * `isFreePlanUser` — gate PURO do upsell estático no limite de cota (Fase 2 de billing, flag-off,
 * docs/reports/fase2-billing-decisao.md §6 item 5). `pro` é o ÚNICO valor que esconde o upsell;
 * qualquer outra coisa (ausente, `'free'`, string desconhecida) trata como free — fail-safe: nunca
 * esconde o upsell por engano de um valor cru inesperado da sessão.
 */
describe('isFreePlanUser — gate do upsell de limite (Fase 2, flag-off)', () => {
  it('pro NÃO é free (some o upsell)', () => {
    expect(isFreePlanUser('pro')).toBe(false)
  })

  it('free É free (mostra o upsell)', () => {
    expect(isFreePlanUser('free')).toBe(true)
  })

  it('ausente (null/undefined) É tratado como free — default fail-safe', () => {
    expect(isFreePlanUser(null)).toBe(true)
    expect(isFreePlanUser(undefined)).toBe(true)
  })

  it('valor desconhecido É tratado como free (nunca esconde o upsell por engano)', () => {
    expect(isFreePlanUser('enterprise')).toBe(true)
  })
})
