import { describe, it, expect } from 'vitest'
import {
  parseRecipeOfWeekConfig,
  DEFAULT_RECIPE_OF_WEEK_CONFIG,
} from '@/domain/recipe-of-week-config'

describe('parseRecipeOfWeekConfig (#457)', () => {
  it('default é sem escolha (recipeId null)', () => {
    expect(DEFAULT_RECIPE_OF_WEEK_CONFIG).toEqual({ recipeId: null })
  })

  it('aceita recipeId null (limpar a escolha)', () => {
    expect(parseRecipeOfWeekConfig({ recipeId: null })).toEqual({ ok: true, value: { recipeId: null } })
  })

  it('aceita um uuid válido', () => {
    const id = '11111111-1111-1111-1111-111111111111'
    expect(parseRecipeOfWeekConfig({ recipeId: id })).toEqual({ ok: true, value: { recipeId: id } })
  })

  it('aceita uuid maiúsculo (case-insensitive)', () => {
    const id = '11111111-1111-1111-1111-111111111111'.toUpperCase()
    expect(parseRecipeOfWeekConfig({ recipeId: id })).toEqual({ ok: true, value: { recipeId: id } })
  })

  it('rejeita recipeId com forma inválida (não-uuid)', () => {
    expect(parseRecipeOfWeekConfig({ recipeId: 'not-a-uuid' }).ok).toBe(false)
    expect(parseRecipeOfWeekConfig({ recipeId: '' }).ok).toBe(false)
    expect(parseRecipeOfWeekConfig({ recipeId: 123 }).ok).toBe(false)
  })

  it('rejeita recipeId ausente (chave obrigatória, mesmo que null)', () => {
    expect(parseRecipeOfWeekConfig({}).ok).toBe(false)
  })

  it('rejeita entrada não-objeto', () => {
    expect(parseRecipeOfWeekConfig(null).ok).toBe(false)
    expect(parseRecipeOfWeekConfig('nope').ok).toBe(false)
    expect(parseRecipeOfWeekConfig([]).ok).toBe(false)
  })
})
