import { describe, it, expect } from 'vitest'
import { decideVote } from '@/domain/vote'

/**
 * Tabela-verdade do não-autovoto (issue #16, AC2). Módulo PURO — sem DB. A ÚNICA recusa
 * é `voterId === recipeOwnerId`; Catálogo (owner null) é sempre votável.
 */

describe('decideVote — não-autovoto (AC2)', () => {
  it('voterId === recipeOwnerId ⇒ recusa auto_voto (dono não vota na própria)', () => {
    expect(decideVote({ voterId: 'u1', recipeOwnerId: 'u1' })).toEqual({
      allowed: false,
      reason: 'auto_voto',
    })
  })

  it('voterId !== recipeOwnerId ⇒ permitido (votar na Receita de outro)', () => {
    expect(decideVote({ voterId: 'u1', recipeOwnerId: 'u2' })).toEqual({ allowed: true })
  })

  it('recipeOwnerId null (Catálogo/sistema) ⇒ permitido (nunca casa o voterId)', () => {
    expect(decideVote({ voterId: 'u1', recipeOwnerId: null })).toEqual({ allowed: true })
  })
})
