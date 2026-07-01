import { describe, expect, it } from 'vitest'
import { eligibleForPool, eligibleToSaveByViewer } from '@/domain/recipe-pool'
import { CURATION_STATUSES, type CurationStatus } from '@/domain/recipe-curation'

/**
 * Predicado de POOL (issue #18 + #168 + #238) — matriz owner(null/owned) × visibility(public/private)
 * × resultKind(playful/não) × moderationRemovedAt(null/set) × origin(web_imported/outro) ×
 * curationStatus. Único caminho elegível: no pool — Catálogo (owner NULL) **e CURADO** (`approved`,
 * #238/ADR-0026) OU public —, não-playful, NÃO removido por moderação, E origin ≠ web_imported.
 */

const REMOVED = new Date('2026-06-18T00:00:00Z')

describe('eligibleForPool', () => {
  it('catálogo (owner NULL) APROVADO, success, não-removido ⇒ elegível', () => {
    expect(
      eligibleForPool({
        ownerId: null,
        visibility: 'private',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'catalog',
        curationStatus: 'approved',
      }),
    ).toBe(true)
  })

  it('catálogo (owner NULL) pending/editing/rejected ⇒ NÃO elegível (rascunho fora do pool, #238)', () => {
    for (const curationStatus of ['pending', 'editing', 'rejected'] as CurationStatus[]) {
      expect(
        eligibleForPool({
          ownerId: null,
          visibility: 'private',
          resultKind: 'success',
          moderationRemovedAt: null,
          origin: 'catalog',
          curationStatus,
        }),
      ).toBe(false)
    }
  })

  it('comunidade pública, success, não-removido ⇒ elegível', () => {
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'ai_chat',
        curationStatus: 'not_required',
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
        curationStatus: 'not_required',
      }),
    ).toBe(false)
  })

  it('playful ⇒ NÃO elegível mesmo se pública/catálogo-aprovado', () => {
    expect(
      eligibleForPool({
        ownerId: null,
        visibility: 'private',
        resultKind: 'playful',
        moderationRemovedAt: null,
        origin: 'ai_chat',
        curationStatus: 'approved',
      }),
    ).toBe(false)
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'playful',
        moderationRemovedAt: null,
        origin: 'ai_chat',
        curationStatus: 'not_required',
      }),
    ).toBe(false)
  })

  it('moderationRemovedAt setado ⇒ NÃO elegível, mesmo pública/catálogo-aprovado/success (AC3)', () => {
    expect(
      eligibleForPool({
        ownerId: null,
        visibility: 'private',
        resultKind: 'success',
        moderationRemovedAt: REMOVED,
        origin: 'catalog',
        curationStatus: 'approved',
      }),
    ).toBe(false)
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'success',
        moderationRemovedAt: REMOVED,
        origin: 'ai_chat',
        curationStatus: 'not_required',
      }),
    ).toBe(false)
  })

  // ── #168/ADR-0019: web_imported NUNCA no pool (cinto-e-suspensório) ──────────────
  it('web_imported ⇒ NÃO elegível mesmo se aparentar pública+success+não-removida', () => {
    expect(
      eligibleForPool({
        ownerId: 'u1',
        visibility: 'public',
        resultKind: 'success',
        moderationRemovedAt: null,
        origin: 'web_imported',
        curationStatus: 'not_required',
      }),
    ).toBe(false)
  })

  it('matriz exaustiva: só (no pool ∧ não-playful ∧ não-removido ∧ ≠ web_imported) é true', () => {
    for (const ownerId of [null, 'u1']) {
      for (const visibility of ['public', 'private']) {
        for (const resultKind of ['success', 'degraded', 'playful']) {
          for (const moderationRemovedAt of [null, REMOVED]) {
            for (const origin of ['catalog', 'ai_chat', 'user_edited', 'web_imported']) {
              for (const curationStatus of CURATION_STATUSES as readonly CurationStatus[]) {
                const inPool =
                  (ownerId == null && curationStatus === 'approved') || visibility === 'public'
                const expected =
                  inPool &&
                  resultKind !== 'playful' &&
                  moderationRemovedAt == null &&
                  origin !== 'web_imported'
                expect(
                  eligibleForPool({ ownerId, visibility, resultKind, moderationRemovedAt, origin, curationStatus }),
                ).toBe(expected)
              }
            }
          }
        }
      }
    }
  })
})

/**
 * Predicado de SALVAR (issue #362/ADR-0027 D2) — o pool público MAIS um escape-hatch de ownership: o
 * DONO salva a PRÓPRIA receita mesmo PRIVADA ("pra montar o caderno"), mantendo as demais barreiras
 * (não-playful, não-removida, não-web). Privada de OUTRO fica fora ⇒ 404 leak-safe.
 */
describe('eligibleToSaveByViewer', () => {
  const VIEWER = 'viewer-1'
  const base = {
    visibility: 'private',
    resultKind: 'success',
    moderationRemovedAt: null as Date | null,
    origin: 'ai_chat',
    curationStatus: 'not_required' as CurationStatus,
  }

  it('própria receita PRIVADA (owner === viewer) ⇒ salvável (escape-hatch)', () => {
    expect(eligibleToSaveByViewer({ ...base, ownerId: VIEWER }, VIEWER)).toBe(true)
  })

  it('receita PRIVADA de OUTRO ⇒ NÃO salvável (leak-safe)', () => {
    expect(eligibleToSaveByViewer({ ...base, ownerId: 'other' }, VIEWER)).toBe(false)
  })

  it('pública de outro ⇒ salvável (delega a eligibleForPool)', () => {
    expect(
      eligibleToSaveByViewer({ ...base, ownerId: 'other', visibility: 'public' }, VIEWER),
    ).toBe(true)
  })

  it('catálogo aprovado (owner NULL) ⇒ salvável (delega a eligibleForPool; null nunca casa o viewer)', () => {
    expect(
      eligibleToSaveByViewer(
        { ...base, ownerId: null, origin: 'catalog', curationStatus: 'approved' },
        VIEWER,
      ),
    ).toBe(true)
  })

  it('catálogo rascunho (owner NULL, pending) ⇒ NÃO salvável', () => {
    expect(
      eligibleToSaveByViewer(
        { ...base, ownerId: null, origin: 'catalog', curationStatus: 'pending' },
        VIEWER,
      ),
    ).toBe(false)
  })

  it('própria privada mas playful ⇒ NÃO salvável (escape-hatch mantém a barreira)', () => {
    expect(
      eligibleToSaveByViewer({ ...base, ownerId: VIEWER, resultKind: 'playful' }, VIEWER),
    ).toBe(false)
  })

  it('própria privada mas removida por moderação ⇒ NÃO salvável', () => {
    expect(
      eligibleToSaveByViewer({ ...base, ownerId: VIEWER, moderationRemovedAt: REMOVED }, VIEWER),
    ).toBe(false)
  })

  it('própria privada mas web_imported ⇒ NÃO salvável', () => {
    expect(
      eligibleToSaveByViewer({ ...base, ownerId: VIEWER, origin: 'web_imported' }, VIEWER),
    ).toBe(false)
  })
})
