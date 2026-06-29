import { describe, expect, it } from 'vitest'
import { isCommunityVisible } from '@/domain/recipe-visibility-check'
import type { Visibility } from '@/domain/recipe'
import { CURATION_STATUSES, type CurationStatus } from '@/domain/recipe-curation'

/**
 * Visibilidade-de-comunidade (issue #52 + #238/ADR-0026) —
 * `(owner_id IS NULL AND curation_status = 'approved') OR visibility = 'public'`.
 *
 * #238: o ramo Catálogo (owner NULL) ganhou a exigência de CURADORIA — um rascunho de catálogo
 * pending/editing/rejected NÃO é comunidade-visível (fica escondido até o Curador aprovar);
 * só `approved` é público. Receita de usuário (owner setado) é governada pela Visibilidade,
 * com `curation_status='not_required'` (curadoria não se aplica). Single-source do gate de
 * leitura pública (route/derive/traduções/Busca/feed).
 */
describe('isCommunityVisible', () => {
  it('Catálogo (owner NULL) APROVADO ⇒ true mesmo com visibility private', () => {
    expect(isCommunityVisible(null, 'private', 'approved')).toBe(true)
  })

  it('Catálogo (owner NULL) pending/editing/rejected ⇒ false (rascunho escondido, #238)', () => {
    expect(isCommunityVisible(null, 'private', 'pending')).toBe(false)
    expect(isCommunityVisible(null, 'private', 'editing')).toBe(false)
    expect(isCommunityVisible(null, 'private', 'rejected')).toBe(false)
  })

  it('owner setado + public ⇒ true (Visibilidade governa; curadoria não se aplica)', () => {
    expect(isCommunityVisible('u1', 'public', 'not_required')).toBe(true)
  })

  it('owner setado + private ⇒ false (privada de usuário)', () => {
    expect(isCommunityVisible('u1', 'private', 'not_required')).toBe(false)
  })

  it('matriz exaustiva: só (owner NULL ∧ approved) ∨ public é true', () => {
    for (const ownerId of [null, 'u1']) {
      for (const visibility of ['public', 'private'] as Visibility[]) {
        for (const curationStatus of CURATION_STATUSES as readonly CurationStatus[]) {
          const expected = (ownerId == null && curationStatus === 'approved') || visibility === 'public'
          expect(isCommunityVisible(ownerId, visibility, curationStatus)).toBe(expected)
        }
      }
    }
  })
})
