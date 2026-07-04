import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECIPE_VARIANT_CONFIG,
  parseRecipeVariantConfig,
} from '@/domain/recipe-variant-config'

/**
 * Config da variação de geração (#423, ADR-0029 dec.6) — PURO. Espelha o teste de `parseImageGenConfig`:
 * aceita o objeto completo, REJEITA pólo/instrução vazios, e trima as strings.
 */

const valido = {
  enabled: true,
  poloA: 'tradicional',
  poloB: 'com um toque criativo',
  instrucao: 'Divirjam no método, não na identidade do prato.',
}

describe('parseRecipeVariantConfig', () => {
  it('aceita um objeto completo e válido (enabled true/false)', () => {
    for (const enabled of [true, false]) {
      const p = parseRecipeVariantConfig({ ...valido, enabled })
      expect(p.ok).toBe(true)
      if (p.ok) expect(p.value).toEqual({ ...valido, enabled })
    }
  })

  it('TRIMA poloA/poloB/instrucao no valor devolvido', () => {
    const p = parseRecipeVariantConfig({
      enabled: true,
      poloA: '  rápida  ',
      poloB: '\tcaprichada\n',
      instrucao: '  varie o empratamento  ',
    })
    expect(p.ok).toBe(true)
    if (p.ok) {
      expect(p.value.poloA).toBe('rápida')
      expect(p.value.poloB).toBe('caprichada')
      expect(p.value.instrucao).toBe('varie o empratamento')
    }
  })

  it('REJEITA poloA vazio / só-espaço', () => {
    for (const poloA of ['', '   ', '\t']) {
      expect(parseRecipeVariantConfig({ ...valido, poloA }).ok).toBe(false)
    }
  })

  it('REJEITA poloB vazio', () => {
    expect(parseRecipeVariantConfig({ ...valido, poloB: '' }).ok).toBe(false)
  })

  it('REJEITA instrucao vazia', () => {
    expect(parseRecipeVariantConfig({ ...valido, instrucao: '  ' }).ok).toBe(false)
  })

  it('REJEITA enabled não-boolean', () => {
    expect(parseRecipeVariantConfig({ ...valido, enabled: 'sim' }).ok).toBe(false)
    expect(parseRecipeVariantConfig({ ...valido, enabled: 1 }).ok).toBe(false)
  })

  it('REJEITA pólo não-string', () => {
    expect(parseRecipeVariantConfig({ ...valido, poloA: 42 }).ok).toBe(false)
    expect(parseRecipeVariantConfig({ ...valido, poloB: null }).ok).toBe(false)
  })

  it('REJEITA não-objeto / array / null', () => {
    for (const raw of [null, undefined, 'x', 42, [], [valido]]) {
      expect(parseRecipeVariantConfig(raw).ok).toBe(false)
    }
  })

  it('DEFAULT nasce DESLIGADO com pólos preenchidos (opt-in, custa 2×)', () => {
    expect(DEFAULT_RECIPE_VARIANT_CONFIG.enabled).toBe(false)
    expect(DEFAULT_RECIPE_VARIANT_CONFIG.poloA.trim()).not.toBe('')
    expect(DEFAULT_RECIPE_VARIANT_CONFIG.poloB.trim()).not.toBe('')
    expect(DEFAULT_RECIPE_VARIANT_CONFIG.instrucao.trim()).not.toBe('')
    // O default é ele mesmo um objeto válido (round-trip).
    expect(parseRecipeVariantConfig(DEFAULT_RECIPE_VARIANT_CONFIG).ok).toBe(true)
  })
})
