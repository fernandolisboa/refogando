import { describe, it, expect } from 'vitest'
import { decideVisibilityTransition } from '@/domain/recipe-visibility'
import { RESULT_KINDS, VISIBILIDADES } from '@/domain/recipe'

/**
 * Tabela-verdade da máquina de transição de Visibilidade (issue #13, §3.1). Módulo
 * PURO — sem DB. Cobre as 12 células (3 result_kind × 2 current × 2 target) célula
 * por célula, mais um loop defensivo afirmando que a ÚNICA recusa é
 * `playful + target='public'` (fecha a tabela inteira por construção).
 */

describe('decideVisibilityTransition — tabela-verdade', () => {
  // ── success ─────────────────────────────────────────────────────────────────
  it('success private→public ⇒ allowed, changed', () => {
    expect(decideVisibilityTransition({ resultKind: 'success', current: 'private', target: 'public' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('success public→private ⇒ allowed, changed', () => {
    expect(decideVisibilityTransition({ resultKind: 'success', current: 'public', target: 'private' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('success public→public ⇒ allowed, no-op (publicar já-pública)', () => {
    expect(decideVisibilityTransition({ resultKind: 'success', current: 'public', target: 'public' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  it('success private→private ⇒ allowed, no-op (despublicar já-privada)', () => {
    expect(decideVisibilityTransition({ resultKind: 'success', current: 'private', target: 'private' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  // ── degraded (paridade com success: publicável) ──────────────────────────────
  it('degraded private→public ⇒ allowed, changed (degraded é publicável)', () => {
    expect(decideVisibilityTransition({ resultKind: 'degraded', current: 'private', target: 'public' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('degraded public→private ⇒ allowed, changed (paridade no despublicar)', () => {
    expect(decideVisibilityTransition({ resultKind: 'degraded', current: 'public', target: 'private' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('degraded public→public ⇒ allowed, no-op', () => {
    expect(decideVisibilityTransition({ resultKind: 'degraded', current: 'public', target: 'public' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  it('degraded private→private ⇒ allowed, no-op', () => {
    expect(decideVisibilityTransition({ resultKind: 'degraded', current: 'private', target: 'private' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  // ── playful (não publicável) ─────────────────────────────────────────────────
  it('playful private→public ⇒ RECUSA playful_nao_publicavel', () => {
    expect(decideVisibilityTransition({ resultKind: 'playful', current: 'private', target: 'public' })).toEqual({
      allowed: false,
      reason: 'playful_nao_publicavel',
    })
  })

  it('playful public→public ⇒ RECUSA (alvo público + playful; estado inalcançável, mesma regra)', () => {
    expect(decideVisibilityTransition({ resultKind: 'playful', current: 'public', target: 'public' })).toEqual({
      allowed: false,
      reason: 'playful_nao_publicavel',
    })
  })

  it('playful private→private ⇒ allowed, no-op (despublicar zoeira já-privada)', () => {
    expect(decideVisibilityTransition({ resultKind: 'playful', current: 'private', target: 'private' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  it('playful public→private ⇒ allowed, changed (estado inalcançável; regra pura não recusa target=private)', () => {
    expect(decideVisibilityTransition({ resultKind: 'playful', current: 'public', target: 'private' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  // ── Loop defensivo: fecha a tabela-verdade inteira por construção ─────────────
  it('a ÚNICA recusa em todo o espaço é playful + target=public', () => {
    for (const resultKind of RESULT_KINDS) {
      for (const current of VISIBILIDADES) {
        for (const target of VISIBILIDADES) {
          const result = decideVisibilityTransition({ resultKind, current, target })
          const expectRefusal = resultKind === 'playful' && target === 'public'
          if (expectRefusal) {
            expect(result).toEqual({ allowed: false, reason: 'playful_nao_publicavel' })
          } else {
            expect(result).toEqual({ allowed: true, changed: target !== current })
          }
        }
      }
    }
  })
})
