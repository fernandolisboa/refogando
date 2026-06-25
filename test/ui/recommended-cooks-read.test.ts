import { describe, it, expect } from 'vitest'
import {
  shouldShowRecommendedRail,
  RECOMMENDED_COOKS_MIN,
  RECOMMENDED_COOKS_LIMIT,
} from '@/domain/recommended-cooks-read'

/** Knobs + gate de presença PUROS do trilho (#278) — sem DB (roda no projeto ui). */
describe('recommended-cooks-read (#278)', () => {
  it('shouldShowRecommendedRail: esconde abaixo do limiar, mostra a partir dele', () => {
    expect(shouldShowRecommendedRail(0)).toBe(false)
    expect(shouldShowRecommendedRail(RECOMMENDED_COOKS_MIN - 1)).toBe(false)
    expect(shouldShowRecommendedRail(RECOMMENDED_COOKS_MIN)).toBe(true)
    expect(shouldShowRecommendedRail(RECOMMENDED_COOKS_MIN + 1)).toBe(true)
  })

  it('knobs sãos: 0 < MIN <= LIMIT', () => {
    expect(RECOMMENDED_COOKS_MIN).toBeGreaterThan(0)
    expect(RECOMMENDED_COOKS_MIN).toBeLessThanOrEqual(RECOMMENDED_COOKS_LIMIT)
  })
})
