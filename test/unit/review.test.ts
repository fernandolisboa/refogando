import { describe, it, expect } from 'vitest'
import { decideReview, MAX_REVIEW_COMMENT_LEN } from '@/domain/review'

/**
 * Tabela-verdade de `decideReview` (issue #363, AC). Módulo PURO — sem DB. Ordem das recusas:
 * nota inválida > comentário inválido > auto-avaliação. Catálogo (owner null) é sempre avaliável.
 */

describe('decideReview — nota', () => {
  it.each([0, 6, 1.5, -1, NaN, Number.POSITIVE_INFINITY])(
    'nota %s ⇒ recusa invalid_rating',
    (rating) => {
      expect(decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating, comment: null })).toEqual({
        allowed: false,
        reason: 'invalid_rating',
      })
    },
  )

  it.each([1, 2, 3, 4, 5])('nota %s (inteira, 1–5) ⇒ permitido', (rating) => {
    expect(decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating, comment: null })).toEqual({
      allowed: true,
      comment: null,
    })
  })
})

describe('decideReview — auto-avaliação', () => {
  it('reviewerId === ownerId ⇒ recusa auto_review', () => {
    expect(decideReview({ reviewerId: 'u1', recipeOwnerId: 'u1', rating: 5, comment: null })).toEqual({
      allowed: false,
      reason: 'auto_review',
    })
  })

  it('ownerId null (Catálogo) ⇒ permitido mesmo com ids "iguais" (null nunca casa string)', () => {
    expect(decideReview({ reviewerId: 'u1', recipeOwnerId: null, rating: 4, comment: 'ok' })).toEqual({
      allowed: true,
      comment: 'ok',
    })
  })

  it('reviewerId !== ownerId ⇒ permitido', () => {
    expect(decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 3, comment: null })).toEqual({
      allowed: true,
      comment: null,
    })
  })
})

describe('decideReview — comentário (normalização/validação)', () => {
  it('trim: espaços em volta são removidos', () => {
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment: '  delícia  ' }),
    ).toEqual({ allowed: true, comment: 'delícia' })
  })

  it("string só de espaços ⇒ comment null (ausente)", () => {
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment: '   ' }),
    ).toEqual({ allowed: true, comment: null })
  })

  it.each([{}, [1], 42, true, undefined, null])(
    'não-string (%s) ⇒ tratado como ausente (comment null), NUNCA [object Object]',
    (comment) => {
      expect(
        decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment }),
      ).toEqual({ allowed: true, comment: null })
    },
  )

  it('NUL (U+0000) é removido do comentário — sanitizado (permitido), NUNCA chega ao Postgres (evita 500)', () => {
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment: 'abc\x00def' }),
    ).toEqual({ allowed: true, comment: 'abcdef' })
  })

  it('comentário só de NUL ⇒ comment null (ausente após stripping + trim)', () => {
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment: '\x00\x00' }),
    ).toEqual({ allowed: true, comment: null })
  })

  it('quebras de linha long-form (\\n/\\t) são PRESERVADAS (só o NUL é removido)', () => {
    expect(
      decideReview({
        reviewerId: 'u1',
        recipeOwnerId: 'u2',
        rating: 5,
        comment: 'linha 1\nlinha 2\tfim',
      }),
    ).toEqual({ allowed: true, comment: 'linha 1\nlinha 2\tfim' })
  })

  it('comentário no limite do cap ⇒ permitido; acima do cap ⇒ invalid_comment', () => {
    const atCap = 'x'.repeat(MAX_REVIEW_COMMENT_LEN)
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment: atCap }),
    ).toEqual({ allowed: true, comment: atCap })

    const overCap = 'x'.repeat(MAX_REVIEW_COMMENT_LEN + 1)
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 5, comment: overCap }),
    ).toEqual({ allowed: false, reason: 'invalid_comment' })
  })

  it('nota inválida tem precedência sobre comentário inválido', () => {
    const overCap = 'x'.repeat(MAX_REVIEW_COMMENT_LEN + 1)
    expect(
      decideReview({ reviewerId: 'u1', recipeOwnerId: 'u2', rating: 0, comment: overCap }),
    ).toEqual({ allowed: false, reason: 'invalid_rating' })
  })
})
