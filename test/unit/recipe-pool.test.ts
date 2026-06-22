import { describe, expect, it } from 'vitest'
import { eligibleForPool } from '@/domain/recipe-pool'

/**
 * Predicado de POOL (issue #18 + #168) — matriz owner(null/owned) × visibility(public/private) ×
 * resultKind(playful/não) × moderationRemovedAt(null/set) × origin(web_imported/outro). Único
 * caminho elegível: no pool (owner NULL OU public), não-playful, NÃO removido por moderação, E
 * origin ≠ web_imported (ADR-0019: importada da web NUNCA entra no pool — cinto-e-suspensório).
 */

const REMOVED = new Date('2026-06-18T00:00:00Z')

describe('eligibleForPool', () => {
  it('catálogo (owner NULL), success, não-removido ⇒ elegível', () => {
    expect(
      eligibleForPool({
        ownerId: null,
        visibility: 'private',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'catalog',
      }),
    ).toBe(true)
  })

  it('comunidade pública, success, não-removido ⇒ elegível', () => {
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'ai_chat',
      }),
    ).toBe(true)
  })

  it('owned private ⇒ NÃO elegível (fora do pool)', () => {
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'private',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'ai_chat',
      }),
    ).toBe(false)
  })

  it('playful ⇒ NÃO elegível mesmo se pública/catálogo', () => {
    expect(
      eligibleForPool({
        ownerId: null,
        visibility: 'private',
        resultKind: 'playful',
        moderationRemovedAt: null,
        origin: 'ai_chat',
      }),
    ).toBe(false)
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'playful',
        moderationRemovedAt: null,
        origin: 'ai_chat',
      }),
    ).toBe(false)
  })

  it('moderationRemovedAt setado ⇒ NÃO elegível, mesmo pública/catálogo/success (AC3)', () => {
    expect(
      eligibleForPool({
        ownerId: null,
        visibility: 'private',
        resultKind: 'success',
        moderationRemovedAt: REMOVED,
        origin: 'catalog',
      }),
    ).toBe(false)
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'success',
        moderationRemovedAt: REMOVED,
        origin: 'ai_chat',
      }),
    ).toBe(false)
  })

  // ── #168/ADR-0019: web_imported NUNCA no pool (cinto-e-suspensório) ──────────────
  it('web_imported ⇒ NÃO elegível mesmo se aparentar pública+success+não-removida', () => {
    // Estado normalmente inalcançável (web_imported é sempre private), mas o gate barra de
    // qualquer modo: defense-in-depth contra um bug que vazasse uma importada para public.
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'web_imported',
      }),
    ).toBe(false)
  })

  it('matriz exaustiva: só (no pool ∧ não-playful ∧ não-removido ∧ ≠ web_imported) é true', () => {
    for (const ownerId of [null, 'u1']) {
      for (const visibility of ['public', 'private']) {
        for (const resultKind of ['success', 'degraded', 'playful']) {
          for (const moderationRemovedAt of [null, REMOVED]) {
            for (const origin of ['catalog', 'ai_chat', 'user_edited', 'web_imported']) {
              const inPoolVisibility = ownerId == null || visibility === 'public'
              const expected =
                inPoolVisibility &&
                resultKind !== 'playful' &&
                moderationRemovedAt == null &&
                origin !== 'web_imported'
              expect(eligibleForPool({ ownerId, visibility, resultKind, moderationRemovedAt, origin })).toBe(expected)
            }
          }
        }
      }
    }
  })
})
