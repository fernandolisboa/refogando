import { describe, it, expect } from 'vitest'
import { decideVisibilityTransition } from '@/domain/recipe-visibility'
import { ORIGENS, RESULT_KINDS, VISIBILIDADES } from '@/domain/recipe'

/**
 * Tabela-verdade da máquina de transição de Visibilidade (issue #13, §3.1). Módulo
 * PURO — sem DB. As células usam um `origin` publicável (ex.: `ai_chat`) por padrão;
 * o eixo de proveniência (web_imported, #168/ADR-0019) tem seu próprio bloco e o loop
 * defensivo no fim cobre o produto cartesiano origin × result_kind × current × target.
 *
 * Duas recusas em todo o espaço:
 *  - `playful + target='public'` (ADR-0013) ⇒ `playful_nao_publicavel`;
 *  - `origin='web_imported' + target='public'` (ADR-0019) ⇒ `web_imported_nao_publicavel`.
 * web_imported tem PRECEDÊNCIA (republicar conteúdo de terceiros é a recusa mais forte).
 */

// Origin publicável neutro p/ as células que não exercitam o eixo de proveniência.
const ORIGIN_OK = 'ai_chat'

describe('decideVisibilityTransition — tabela-verdade', () => {
  // ── success ─────────────────────────────────────────────────────────────────
  it('success private→public ⇒ allowed, changed', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'success', current: 'private', target: 'public' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('success public→private ⇒ allowed, changed', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'success', current: 'public', target: 'private' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('success public→public ⇒ allowed, no-op (publicar já-pública)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'success', current: 'public', target: 'public' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  it('success private→private ⇒ allowed, no-op (despublicar já-privada)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'success', current: 'private', target: 'private' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  // ── degraded (paridade com success: publicável) ──────────────────────────────
  it('degraded private→public ⇒ allowed, changed (degraded é publicável)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'degraded', current: 'private', target: 'public' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('degraded public→private ⇒ allowed, changed (paridade no despublicar)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'degraded', current: 'public', target: 'private' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  it('degraded public→public ⇒ allowed, no-op', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'degraded', current: 'public', target: 'public' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  it('degraded private→private ⇒ allowed, no-op', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'degraded', current: 'private', target: 'private' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  // ── playful (não publicável) ─────────────────────────────────────────────────
  it('playful private→public ⇒ RECUSA playful_nao_publicavel', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'playful', current: 'private', target: 'public' })).toEqual({
      allowed: false,
      reason: 'playful_nao_publicavel',
    })
  })

  it('playful public→public ⇒ RECUSA (alvo público + playful; estado inalcançável, mesma regra)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'playful', current: 'public', target: 'public' })).toEqual({
      allowed: false,
      reason: 'playful_nao_publicavel',
    })
  })

  it('playful private→private ⇒ allowed, no-op (despublicar zoeira já-privada)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'playful', current: 'private', target: 'private' })).toEqual({
      allowed: true,
      changed: false,
    })
  })

  it('playful public→private ⇒ allowed, changed (estado inalcançável; regra pura não recusa target=private)', () => {
    expect(decideVisibilityTransition({ origin: ORIGIN_OK, resultKind: 'playful', current: 'public', target: 'private' })).toEqual({
      allowed: true,
      changed: true,
    })
  })

  // ── web_imported (ADR-0019/#168): NUNCA pública ──────────────────────────────
  it('web_imported private→public ⇒ RECUSA web_imported_nao_publicavel', () => {
    expect(
      decideVisibilityTransition({ origin: 'web_imported', resultKind: 'success', current: 'private', target: 'public' }),
    ).toEqual({ allowed: false, reason: 'web_imported_nao_publicavel' })
  })

  it('web_imported private→private ⇒ allowed, no-op (importada nasce e fica privada)', () => {
    expect(
      decideVisibilityTransition({
        origin: 'web_imported',
        resultKind: 'success',
        current: 'private',
        target: 'private',
      }),
    ).toEqual({ allowed: true, changed: false })
  })

  it('web_imported public→private ⇒ allowed, changed (estado inalcançável; despublicar nunca é recusado)', () => {
    expect(
      decideVisibilityTransition({ origin: 'web_imported', resultKind: 'success', current: 'public', target: 'private' }),
    ).toEqual({ allowed: true, changed: true })
  })

  it('web_imported tem precedência sobre playful: playful+web_imported→public ⇒ web_imported_nao_publicavel', () => {
    expect(
      decideVisibilityTransition({ origin: 'web_imported', resultKind: 'playful', current: 'private', target: 'public' }),
    ).toEqual({ allowed: false, reason: 'web_imported_nao_publicavel' })
  })

  // ── user/IA → public continua permitido (regressão da regra existente) ────────
  it.each(['ai_chat', 'ai_structured', 'ai_free_text', 'user_edited', 'catalog'] as const)(
    '%s private→public ⇒ allowed, changed (origins publicáveis não são afetados)',
    (origin) => {
      expect(
        decideVisibilityTransition({ origin, resultKind: 'success', current: 'private', target: 'public' }),
      ).toEqual({ allowed: true, changed: true })
    },
  )

  // ── Loop defensivo: fecha a tabela-verdade inteira (origin × kind × cur × tgt) ──
  it('as ÚNICAS recusas em todo o espaço são web_imported→public e playful→public', () => {
    for (const origin of ORIGENS) {
      for (const resultKind of RESULT_KINDS) {
        for (const current of VISIBILIDADES) {
          for (const target of VISIBILIDADES) {
            const result = decideVisibilityTransition({ origin, resultKind, current, target })
            if (target === 'public' && origin === 'web_imported') {
              // web_imported tem precedência sobre playful.
              expect(result).toEqual({ allowed: false, reason: 'web_imported_nao_publicavel' })
            } else if (target === 'public' && resultKind === 'playful') {
              expect(result).toEqual({ allowed: false, reason: 'playful_nao_publicavel' })
            } else {
              expect(result).toEqual({ allowed: true, changed: target !== current })
            }
          }
        }
      }
    }
  })
})
