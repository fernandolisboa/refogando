import { describe, expect, it } from 'vitest'
import {
  capFromRecipeGenConfig,
  parseRecipeGenCapByRole,
  DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
  type RecipeGenCapByRole,
} from '@/domain/recipe-gen-config'

/**
 * Config do teto de geração de RECEITA (#167) — PURO. `capFromRecipeGenConfig` resolve o teto por
 * papel (null=∞, fail-closed) e `parseRecipeGenCapByRole` valida a entrada do PUT do admin. Espelha
 * `image-gen-config.test.ts` (capFromConfig / parseCapByRole).
 */

describe('capFromRecipeGenConfig — teto por papel a partir da config', () => {
  const caps: RecipeGenCapByRole = { usuario: 10, curador: 20, admin: null }

  it('papel com número ⇒ o número; null ⇒ Infinity (ilimitado)', () => {
    expect(capFromRecipeGenConfig(caps, 'usuario')).toBe(10)
    expect(capFromRecipeGenConfig(caps, 'curador')).toBe(20)
    expect(capFromRecipeGenConfig(caps, 'admin')).toBe(Infinity)
  })

  it('papel null/desconhecido ⇒ fail-closed no teto de usuario', () => {
    expect(capFromRecipeGenConfig(caps, null)).toBe(10)
  })

  it('teto 0 (papel zerado) é repassado como 0 (decideRecipeGenQuota o lê como bloqueado)', () => {
    expect(capFromRecipeGenConfig({ usuario: 0, curador: 20, admin: null }, 'usuario')).toBe(0)
  })

  it('defaults: usuario 10, curador 20, admin ∞', () => {
    expect(capFromRecipeGenConfig(DEFAULT_RECIPE_GEN_CAP_BY_ROLE, 'usuario')).toBe(10)
    expect(capFromRecipeGenConfig(DEFAULT_RECIPE_GEN_CAP_BY_ROLE, 'curador')).toBe(20)
    expect(capFromRecipeGenConfig(DEFAULT_RECIPE_GEN_CAP_BY_ROLE, 'admin')).toBe(Infinity)
  })
})

describe('parseRecipeGenCapByRole — validação do PUT', () => {
  it('objeto válido ⇒ devolve o valor normalizado', () => {
    expect(parseRecipeGenCapByRole({ usuario: 5, curador: 8, admin: null })).toEqual({
      usuario: 5,
      curador: 8,
      admin: null,
    })
  })

  it('defaults passam a própria validação (round-trip)', () => {
    expect(parseRecipeGenCapByRole(DEFAULT_RECIPE_GEN_CAP_BY_ROLE)).toEqual(
      DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
    )
  })

  it('teto 0 é válido (zera o papel)', () => {
    expect(parseRecipeGenCapByRole({ usuario: 0, curador: 8, admin: null })).toEqual({
      usuario: 0,
      curador: 8,
      admin: null,
    })
  })

  it('rejeita teto negativo / float / NaN / string', () => {
    expect(parseRecipeGenCapByRole({ usuario: -1, curador: 8, admin: null })).toBeNull()
    expect(parseRecipeGenCapByRole({ usuario: 2.5, curador: 8, admin: null })).toBeNull()
    expect(parseRecipeGenCapByRole({ usuario: Number.NaN, curador: 8, admin: null })).toBeNull()
    expect(parseRecipeGenCapByRole({ usuario: '3', curador: 8, admin: null })).toBeNull()
  })

  it('rejeita papel faltante ou chave estranha', () => {
    expect(parseRecipeGenCapByRole({ usuario: 2, curador: 4 })).toBeNull()
    expect(parseRecipeGenCapByRole({ usuario: 2, curador: 4, admin: null, root: 9 })).toBeNull()
  })

  it('rejeita não-objeto / null / array', () => {
    expect(parseRecipeGenCapByRole(null)).toBeNull()
    expect(parseRecipeGenCapByRole('x')).toBeNull()
    expect(parseRecipeGenCapByRole([10, 20, null])).toBeNull()
  })
})
