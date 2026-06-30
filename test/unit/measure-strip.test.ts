import { describe, it, expect } from 'vitest'
import {
  looksAlreadyClean,
  stillEmbedsMeasure,
  validateStrippedName,
  stripLeadingConnector,
  normalizeWord,
  buildStripUserPrompt,
} from '../../scripts/lib/measure-strip'

/**
 * Helpers PUROS da migração one-off "tira a medida do raw_text" (ADR-0012/0009 Adendo). O modelo
 * faz a remoção (linguagem); estes guardas determinísticos decidem o que tocar, validam a saída
 * (anti-alucinação) e verificam o resultado. NÃO corrompem dado — rejeitado mantém o original.
 */

describe('looksAlreadyClean — pula o modelo só quando NÃO há medida estruturada', () => {
  it('sem quantidade e sem unidade ⇒ já limpo (não toca, mesmo com número legítimo no nome)', () => {
    expect(looksAlreadyClean(null, null)).toBe(true)
    expect(looksAlreadyClean('', '')).toBe(true)
  })
  it('qualquer medida estruturada (quantidade OU unidade) ⇒ manda pro modelo', () => {
    expect(looksAlreadyClean('320', 'g')).toBe(false)
    expect(looksAlreadyClean('3', null)).toBe(false)
    expect(looksAlreadyClean(null, 'a_gosto')).toBe(false)
  })
})

describe('stillEmbedsMeasure — verificação pós-migração', () => {
  it('nome limpo ⇒ false', () => {
    expect(stillEmbedsMeasure('arroz arbóreo', 'g')).toBe(false)
    expect(stillEmbedsMeasure('sal', 'a_gosto')).toBe(false)
    expect(stillEmbedsMeasure('cenouras médias', 'unidade')).toBe(false)
  })
  it('começa com número/fração ⇒ true (medida-prefixo provável)', () => {
    expect(stillEmbedsMeasure('320 g de arroz arbóreo', 'g')).toBe(true)
    expect(stillEmbedsMeasure('½ xícara de vinho', 'xicara')).toBe(true)
  })
  it('a_gosto/q_b com a frase ainda no texto ⇒ true (sufixo)', () => {
    expect(stillEmbedsMeasure('sal a gosto', 'a_gosto')).toBe(true)
    expect(stillEmbedsMeasure('fermento q.b.', 'q_b')).toBe(true)
  })
  it('frase "a gosto" mas unidade NÃO é a_gosto ⇒ false (não é o eixo do sufixo)', () => {
    expect(stillEmbedsMeasure('molho a gosto', 'g')).toBe(false)
  })
  it('vazio/null ⇒ false', () => {
    expect(stillEmbedsMeasure(null, 'g')).toBe(false)
    expect(stillEmbedsMeasure('   ', 'g')).toBe(false)
  })
})

describe('validateStrippedName — guard anti-alucinação', () => {
  it('redução legítima (medida removida) ⇒ ok', () => {
    expect(validateStrippedName('320 g de arroz arbóreo', 'arroz arbóreo', 'g')).toEqual({ ok: true })
    expect(validateStrippedName('2 xícaras de farinha', 'farinha', 'xicara')).toEqual({ ok: true })
    expect(validateStrippedName('sal a gosto', 'sal', 'a_gosto')).toEqual({ ok: true })
    expect(validateStrippedName('Açúcar refinado', 'Açúcar refinado', null)).toEqual({ ok: true }) // já limpo
    expect(validateStrippedName('100 g de queijo parmesão ralado', 'queijo parmesão ralado', 'g')).toEqual({ ok: true })
  })
  it('DROPAR palavra do NOME ⇒ rejeita (a omissão é a alucinação mais natural de "tira o texto")', () => {
    // o modelo dropa "queijo" e "ralado" — passava no guard antigo (subset, menor, sem dígito novo).
    expect(validateStrippedName('100 g de queijo parmesão ralado', 'parmesão', 'g').ok).toBe(false)
    expect(validateStrippedName('300 g de azeite de oliva extra virgem', 'azeite', 'g').ok).toBe(false)
  })
  it('vazio ⇒ rejeita', () => {
    expect(validateStrippedName('sal a gosto', '   ', 'a_gosto').ok).toBe(false)
  })
  it('mais comprido que o original ⇒ rejeita', () => {
    expect(validateStrippedName('sal', 'sal refinado especial', 'a_gosto').ok).toBe(false)
  })
  it('token NOVO (tradução/rephrase) ⇒ rejeita', () => {
    // "branco" não estava em "açúcar mascavo"
    expect(validateStrippedName('2 xícaras de açúcar mascavo', 'açúcar branco', 'xicara').ok).toBe(false)
    // tradução: "flour" não estava em "farinha de trigo"
    expect(validateStrippedName('200 g de farinha de trigo', 'wheat flour', 'g').ok).toBe(false)
  })
  it('dígito NOVO ⇒ rejeita', () => {
    expect(validateStrippedName('320 g de arroz', '32 arroz', 'g').ok).toBe(false)
  })
  it('dígito legítimo do nome (presente no original) ⇒ ok', () => {
    expect(validateStrippedName('200 ml de leite 2%', 'leite 2%', 'ml')).toEqual({ ok: true })
  })
  it('acento/caixa NÃO contam como token novo nem como sumiço', () => {
    expect(validateStrippedName('2 dentes de ALHO', 'alho', 'dente')).toEqual({ ok: true })
  })
})

describe('stripLeadingConnector — limpa resíduo "de farinha" → "farinha"', () => {
  it('tira UM conector líder', () => {
    expect(stripLeadingConnector('de farinha')).toBe('farinha')
    expect(stripLeadingConnector('of olive oil')).toBe('olive oil')
  })
  it('preserva conector NÃO-líder (no meio do nome)', () => {
    expect(stripLeadingConnector('queijo de Minas')).toBe('queijo de Minas')
  })
  it('não esvazia um nome de 1 palavra que por acaso é um conector', () => {
    expect(stripLeadingConnector('de')).toBe('de')
  })
})

describe('normalizeWord', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizeWord('Açúcar,')).toBe('acucar')
    expect(normalizeWord('ARBÓREO')).toBe('arboreo')
    expect(normalizeWord('2%')).toBe('2')
  })
})

describe('buildStripUserPrompt', () => {
  it('inclui a linha e a medida estruturada', () => {
    const p = buildStripUserPrompt('320 g de arroz arbóreo', '320', 'g')
    expect(p).toContain('Linha: 320 g de arroz arbóreo')
    expect(p).toContain('320 g')
  })
  it('sem medida estruturada ⇒ "(nenhuma)"', () => {
    expect(buildStripUserPrompt('arroz', null, null)).toContain('(nenhuma)')
  })
})
