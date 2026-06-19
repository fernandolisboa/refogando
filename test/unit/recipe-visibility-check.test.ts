import { describe, expect, it } from 'vitest'
import { isCommunityVisible } from '@/domain/recipe-visibility-check'
import type { Visibility } from '@/domain/recipe'

/**
 * Visibilidade-de-comunidade (issue #52) — `owner_id IS NULL OR visibility = 'public'`.
 * Cobre os três ramos: owner NULL (Catálogo) ⇒ true; owner + public ⇒ true; owner + private
 * ⇒ false. Single-source do gate de leitura pública (route/derive/traduções/Busca/feed).
 */
describe('isCommunityVisible', () => {
  it('owner NULL (Catálogo) ⇒ true mesmo com visibility private', () => {
    expect(isCommunityVisible(null, 'private')).toBe(true)
  })

  it('owner NULL + public ⇒ true', () => {
    expect(isCommunityVisible(null, 'public')).toBe(true)
  })

  it('owner setado + public ⇒ true', () => {
    expect(isCommunityVisible('u1', 'public')).toBe(true)
  })

  it('owner setado + private ⇒ false (privada de usuário)', () => {
    expect(isCommunityVisible('u1', 'private')).toBe(false)
  })

  it('matriz exaustiva: só (owner NULL ∨ public) é true', () => {
    for (const ownerId of [null, 'u1']) {
      for (const visibility of ['public', 'private'] as Visibility[]) {
        const expected = ownerId == null || visibility === 'public'
        expect(isCommunityVisible(ownerId, visibility)).toBe(expected)
      }
    }
  })
})
