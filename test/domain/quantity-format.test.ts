import { describe, it, expect } from 'vitest'
import {
  formatQuantityDisplay,
  formatQuantityInput,
  parseQuantityInput,
} from '@/domain/quantity-format'

/**
 * `quantity-format` — formatação de número/fração da medida (ADR-0012 Adendo 2, decisão 4).
 *
 * - DISPLAY (`formatQuantityDisplay`): número por locale (vírgula pt / ponto en, SEM zeros à
 *   direita, SEM agrupamento de milhar) e frações comuns viram GLIFOS (½ ¼ ¾ ⅓ ⅔ ⅛ ⅜ ⅝ ⅞),
 *   inclusive misto ("2½"). O que não casa numa fração comum cai no decimal localizado.
 * - INPUT (`formatQuantityInput`): valor EDITÁVEL no formulário — número localizado, NUNCA glifo
 *   (o usuário precisa digitar), some o `numeric(10,3)` cru ("3.000"→"3").
 * - PARSE (`parseQuantityInput`): texto do formulário → string-ponto canônica para o POST (a zod
 *   do servidor é o guard final); round-trip seguro com `formatQuantityInput`.
 */
describe('formatQuantityDisplay — número localizado + glifos de fração', () => {
  it('corta zeros à direita do numeric(10,3): "3.000" → "3"', () => {
    expect(formatQuantityDisplay('3.000', 'pt-BR')).toBe('3')
    expect(formatQuantityDisplay('3.000', 'en-US')).toBe('3')
  })

  it('fração comum vira GLIFO (locale-neutro): 0.5 → "½"', () => {
    expect(formatQuantityDisplay('0.5', 'pt-BR')).toBe('½')
    expect(formatQuantityDisplay('0.5', 'en-US')).toBe('½')
  })

  it('misto: 2.5 → "2½" (colado, sem espaço)', () => {
    expect(formatQuantityDisplay('2.500', 'pt-BR')).toBe('2½')
    expect(formatQuantityDisplay('2.5', 'en-US')).toBe('2½')
  })

  it('demais glifos do conjunto restrito: ¼ ¾ ⅓ ⅔ ⅛', () => {
    expect(formatQuantityDisplay('0.25', 'pt-BR')).toBe('¼')
    expect(formatQuantityDisplay('0.75', 'pt-BR')).toBe('¾')
    expect(formatQuantityDisplay('0.333', 'pt-BR')).toBe('⅓')
    expect(formatQuantityDisplay('0.667', 'pt-BR')).toBe('⅔')
    expect(formatQuantityDisplay('0.125', 'pt-BR')).toBe('⅛')
  })

  it('tolerância do numeric(10,3): 0.333/0.667 casam ⅓/⅔ dentro do EPS', () => {
    // numeric(10,3) trunca 1/3 → 0.333; |0.333 − 0.3333| ≈ 0.0003 < EPS (0.005).
    expect(formatQuantityDisplay('0.333', 'en-US')).toBe('⅓')
    expect(formatQuantityDisplay('0.667', 'en-US')).toBe('⅔')
  })

  it('0.4 NÃO é um glifo do conjunto restrito → cai no decimal localizado (NÃO ⅖)', () => {
    expect(formatQuantityDisplay('0.4', 'pt-BR')).toBe('0,4')
    expect(formatQuantityDisplay('0.4', 'en-US')).toBe('0.4')
  })

  it('decimal de verdade próximo mas FORA do EPS continua decimal (0.34, não ⅓)', () => {
    expect(formatQuantityDisplay('0.34', 'pt-BR')).toBe('0,34')
  })

  it('sem agrupamento de milhar: 1000 → "1000" (não "1.000" pt)', () => {
    expect(formatQuantityDisplay('1000', 'pt-BR')).toBe('1000')
    expect(formatQuantityDisplay('1000', 'en-US')).toBe('1000')
  })

  it('inteiro grande pt-BR não ganha ponto de milhar', () => {
    expect(formatQuantityDisplay('1500', 'pt-BR')).toBe('1500')
  })

  it('lixo não-numérico (defensivo) sai cru, NUNCA NaN', () => {
    expect(formatQuantityDisplay('a gosto', 'pt-BR')).toBe('a gosto')
  })

  it('aceita vírgula na entrada (defensivo): "2,5" → "2½"', () => {
    expect(formatQuantityDisplay('2,5', 'pt-BR')).toBe('2½')
  })
})

describe('formatQuantityInput — valor editável (sem glifo)', () => {
  it('null/"" → ""', () => {
    expect(formatQuantityInput(null, 'pt-BR')).toBe('')
    expect(formatQuantityInput('', 'pt-BR')).toBe('')
  })

  it('some os zeros do numeric: "3.000" → "3"', () => {
    expect(formatQuantityInput('3.000', 'pt-BR')).toBe('3')
    expect(formatQuantityInput('3.000', 'en-US')).toBe('3')
  })

  it('número localizado, NUNCA glifo: "2.500" → "2,5" (pt) / "2.5" (en)', () => {
    expect(formatQuantityInput('2.500', 'pt-BR')).toBe('2,5')
    expect(formatQuantityInput('2.500', 'en-US')).toBe('2.5')
  })

  it('inteiro grande sem agrupamento: "1000" → "1000"', () => {
    expect(formatQuantityInput('1000', 'pt-BR')).toBe('1000')
  })
})

describe('parseQuantityInput — texto do formulário → string-ponto canônica', () => {
  it('vírgula vira ponto: "2,5" → "2.5"', () => {
    expect(parseQuantityInput('2,5')).toBe('2.5')
  })

  it('"" → null (campo vazio = sem medida)', () => {
    expect(parseQuantityInput('')).toBe(null)
    expect(parseQuantityInput('   ')).toBe(null)
  })

  it('normaliza zeros à direita: "1.250" → "1.25"', () => {
    expect(parseQuantityInput('1.250')).toBe('1.25')
  })

  it('inteiro: "3" → "3"', () => {
    expect(parseQuantityInput('3')).toBe('3')
  })

  it('texto inválido sai cru (a zod do servidor rejeita): "abc" → "abc"', () => {
    expect(parseQuantityInput('abc')).toBe('abc')
  })
})

describe('round-trip — format(1000) → parse → "1000" (sem agrupamento que confunda o parse)', () => {
  it('formatQuantityInput(1000) round-trips', () => {
    const shown = formatQuantityInput('1000', 'pt-BR')
    expect(shown).toBe('1000')
    expect(parseQuantityInput(shown)).toBe('1000')
  })

  it('formatQuantityDisplay(1000) também é "1000" (sem ponto de milhar)', () => {
    expect(formatQuantityDisplay('1000', 'pt-BR')).toBe('1000')
  })

  it('round-trip de fração editável: 2.5 → "2,5" → "2.5"', () => {
    const shown = formatQuantityInput('2.500', 'pt-BR')
    expect(shown).toBe('2,5')
    expect(parseQuantityInput(shown)).toBe('2.5')
  })
})
