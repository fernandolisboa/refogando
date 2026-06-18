import { describe, expect, it } from 'vitest'
import { eligibleForPool } from '@/domain/recipe-pool'

/**
 * Predicado de POOL (issue #18) — matriz owner(null/owned) × visibility(public/private) ×
 * resultKind(playful/não) × moderationRemovedAt(null/set). Único caminho elegível: no pool
 * (owner NULL OU public), não-playful, NÃO removido por moderação.
 */

const REMOVED = new Date('2026-06-18T00:00:00Z')

describe('eligibleForPool', () => {
  it('catálogo (owner NULL), success, não-removido ⇒ elegível', () => {
    expect(
      eligibleForPool({ ownerId: null, visibility: 'private', resultKind: 'success', moderationRemovedAt: null }),
    ).toBe(true)
  })

  it('comunidade pública, success, não-removido ⇒ elegível', () => {
    expect(
      eligibleForPool({ ownerId: 'u1', visibility: 'public', resultKind: 'success', moderationRemovedAt: null }),
    ).toBe(true)
  })

  it('owned private ⇒ NÃO elegível (fora do pool)', () => {
    expect(
      eligibleForPool({ ownerId: 'u1', visibility: 'private', resultKind: 'success', moderationRemovedAt: null }),
    ).toBe(false)
  })

  it('playful ⇒ NÃO elegível mesmo se pública/catálogo', () => {
    expect(
      eligibleForPool({ ownerId: null, visibility: 'private', resultKind: 'playful', moderationRemovedAt: null }),
    ).toBe(false)
    expect(
      eligibleForPool({ ownerId: 'u1', visibility: 'public', resultKind: 'playful', moderationRemovedAt: null }),
    ).toBe(false)
  })

  it('moderationRemovedAt setado ⇒ NÃO elegível, mesmo pública/catálogo/success (AC3)', () => {
    expect(
      eligibleForPool({ ownerId: null, visibility: 'private', resultKind: 'success', moderationRemovedAt: REMOVED }),
    ).toBe(false)
    expect(
      eligibleForPool({ ownerId: 'u1', visibility: 'public', resultKind: 'success', moderationRemovedAt: REMOVED }),
    ).toBe(false)
  })

  it('matriz exaustiva: só (no pool ∧ não-playful ∧ não-removido) é true', () => {
    for (const ownerId of [null, 'u1']) {
      for (const visibility of ['public', 'private']) {
        for (const resultKind of ['success', 'degraded', 'playful']) {
          for (const moderationRemovedAt of [null, REMOVED]) {
            const inPoolVisibility = ownerId == null || visibility === 'public'
            const expected = inPoolVisibility && resultKind !== 'playful' && moderationRemovedAt == null
            expect(eligibleForPool({ ownerId, visibility, resultKind, moderationRemovedAt })).toBe(expected)
          }
        }
      }
    }
  })
})
