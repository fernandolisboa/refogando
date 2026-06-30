import { describe, it, expect } from 'vitest'
import {
  looksAlreadyClean,
  stillEmbedsMeasure,
  stillEmbedsMeasureStrict,
  validateStrippedName,
  stripLeadingConnector,
  stripTrailingNoise,
  normalizeWord,
  buildStripUserPrompt,
  stripLeadingQuantity,
  deterministicStrip,
  detectRepair,
  assertCleanName,
  beginsWithQuantityToken,
  headLooksSingular,
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

describe('stillEmbedsMeasureStrict — varredura pós-reparo alinhada ao detector (FIX 3)', () => {
  it('pega o que o prefixo /^(½|\\d)/ de stillEmbedsMeasure NÃO pega: número ESCRITO líder', () => {
    // a heurística estreita não vê "meia"/"três quartos"; a estrita usa beginsWithQuantityToken.
    expect(stillEmbedsMeasure('meia xícara de óleo', 'xicara')).toBe(false)
    expect(stillEmbedsMeasureStrict('meia xícara de óleo', 'xicara')).toBe(true)
    expect(stillEmbedsMeasureStrict('três quartos de xícara de água', 'xicara')).toBe(true)
  })
  it('número/fração-glifo líder ⇒ true (igual à heurística estreita)', () => {
    expect(stillEmbedsMeasureStrict('320 g de arroz arbóreo', 'g')).toBe(true)
    expect(stillEmbedsMeasureStrict('½ xícara de vinho', 'xicara')).toBe(true)
  })
  it('a_gosto/q_b com a frase ainda no texto ⇒ true (sufixo)', () => {
    expect(stillEmbedsMeasureStrict('sal a gosto', 'a_gosto')).toBe(true)
    expect(stillEmbedsMeasureStrict('fermento q.b.', 'q_b')).toBe(true)
  })
  it('nome limpo ⇒ false; vazio/null ⇒ false', () => {
    expect(stillEmbedsMeasureStrict('arroz arbóreo', 'g')).toBe(false)
    expect(stillEmbedsMeasureStrict('alho fatiados', 'dente')).toBe(false)
    expect(stillEmbedsMeasureStrict(null, 'g')).toBe(false)
    expect(stillEmbedsMeasureStrict('   ', 'g')).toBe(false)
  })
})

describe('validateStrippedName — guard anti-alucinação (preserva o NÚCLEO)', () => {
  it('redução legítima (medida removida) ⇒ ok', () => {
    expect(validateStrippedName('320 g de arroz arbóreo', 'arroz arbóreo')).toEqual({ ok: true })
    expect(validateStrippedName('2 xícaras de farinha', 'farinha')).toEqual({ ok: true })
    expect(validateStrippedName('sal a gosto', 'sal')).toEqual({ ok: true })
    expect(validateStrippedName('Açúcar refinado', 'Açúcar refinado')).toEqual({ ok: true }) // já limpo
    expect(validateStrippedName('100 g de queijo parmesão ralado', 'queijo parmesão ralado')).toEqual({ ok: true })
  })
  it('strip BENÉFICO de porção/recipiente/propósito ⇒ ok (núcleo intacto)', () => {
    // o modelo larga palavras de porção/recipiente que NÃO são a unidade estruturada — desejável.
    expect(validateStrippedName('4 folhas de alga nori', 'alga nori')).toEqual({ ok: true })
    expect(validateStrippedName('1 ramo de tomilho fresco', 'tomilho fresco')).toEqual({ ok: true })
    expect(validateStrippedName('Três quartos de xícara de água', 'água')).toEqual({ ok: true })
    // propósito no fim ("para servir/untar") é ruído — largá-lo mantém o núcleo.
    expect(validateStrippedName('Manteiga para untar', 'Manteiga')).toEqual({ ok: true })
    expect(validateStrippedName('Folhas de alface para servir', 'folhas de alface')).toEqual({ ok: true })
    // parêntese final ("(cerca de 1,2 kg)") é ruído.
    expect(validateStrippedName('1 frango cortado em pedaços (cerca de 1,2 kg)', 'frango cortado em pedaços')).toEqual({ ok: true })
  })
  it('DROPAR o NÚCLEO do nome ⇒ rejeita (omissão corruptora)', () => {
    // dropa "queijo" e "ralado" (o núcleo "ralado" some) — passava no guard antigo (subset/menor).
    expect(validateStrippedName('100 g de queijo parmesão ralado', 'parmesão').ok).toBe(false)
    // dropa "de oliva extra virgem" (núcleo "virgem" some) — perde o nome.
    expect(validateStrippedName('300 g de azeite de oliva extra virgem', 'azeite').ok).toBe(false)
  })
  it('vazio ⇒ rejeita', () => {
    expect(validateStrippedName('sal a gosto', '   ').ok).toBe(false)
  })
  it('mais comprido que o original ⇒ rejeita', () => {
    expect(validateStrippedName('sal', 'sal refinado especial').ok).toBe(false)
  })
  it('token NOVO (tradução/rephrase) ⇒ rejeita', () => {
    // "branco" não estava em "açúcar mascavo"
    expect(validateStrippedName('2 xícaras de açúcar mascavo', 'açúcar branco').ok).toBe(false)
    // tradução: "flour" não estava em "farinha de trigo"
    expect(validateStrippedName('200 g de farinha de trigo', 'wheat flour').ok).toBe(false)
  })
  it('dígito NOVO ⇒ rejeita', () => {
    expect(validateStrippedName('320 g de arroz', '32 arroz').ok).toBe(false)
  })
  it('dígito legítimo do nome (presente no original) ⇒ ok', () => {
    expect(validateStrippedName('200 ml de leite 2%', 'leite 2%')).toEqual({ ok: true })
  })
  it('acento/caixa NÃO contam como token novo nem como sumiço', () => {
    expect(validateStrippedName('2 dentes de ALHO', 'alho')).toEqual({ ok: true })
  })
})

describe('stripTrailingNoise', () => {
  it('tira parêntese final, propósito e frase "a gosto"', () => {
    expect(stripTrailingNoise('frango (cerca de 1,2 kg)')).toBe('frango')
    expect(stripTrailingNoise('manteiga para untar')).toBe('manteiga')
    expect(stripTrailingNoise('sal a gosto')).toBe('sal')
  })
  it('preserva um nome sem ruído', () => {
    expect(stripTrailingNoise('azeite de oliva extra virgem')).toBe('azeite de oliva extra virgem')
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

/**
 * Helpers DETERMINÍSTICOS da REPARAÇÃO (Track B): reconhecem a quantidade-líder de prosa em qualquer
 * forma (inteiro/decimal/fração-barra/glifo/mista/escrita), refazem o strip SEM modelo e classificam
 * uma linha como over-strip (o modelo da migração comeu uma palavra de PORÇÃO genuína), still-embeds
 * (ainda carrega a medida no texto) ou none (já casa o strip determinístico — NÃO tocar; é o caso das
 * frações tipo "1/2 xícara de óleo" → "óleo", que NÃO podem ser corrompidas).
 */
describe('stripLeadingQuantity — reconhecedor abrangente de quantidade-líder', () => {
  it('inteiro + palavra de porção ⇒ tira só o número', () => {
    expect(stripLeadingQuantity('4 folhas de alga nori')).toEqual({
      rest: 'folhas de alga nori',
      hadQuantity: true,
      value: 4,
    })
  })
  it('fração barra (\\d+/\\d+)', () => {
    expect(stripLeadingQuantity('1/2 xícara de óleo')).toEqual({
      rest: 'xícara de óleo',
      hadQuantity: true,
      value: 0.5,
    })
  })
  it('glifo de fração vulgar (½) e inteiro grudado (2½)', () => {
    expect(stripLeadingQuantity('½ xícara de vinho')).toEqual({
      rest: 'xícara de vinho',
      hadQuantity: true,
      value: 0.5,
    })
    expect(stripLeadingQuantity('2½ xícaras de farinha')).toEqual({
      rest: 'xícaras de farinha',
      hadQuantity: true,
      value: 2.5,
    })
  })
  it('mista "\\d+ e 1/2" e "\\d+ e meia"', () => {
    expect(stripLeadingQuantity('1 e 1/2 xícara de leite')).toEqual({
      rest: 'xícara de leite',
      hadQuantity: true,
      value: 1.5,
    })
    expect(stripLeadingQuantity('1 e meia xícara de leite')).toEqual({
      rest: 'xícara de leite',
      hadQuantity: true,
      value: 1.5,
    })
  })
  it('número escrito: meia/meio e três quartos', () => {
    expect(stripLeadingQuantity('Meia xícara de leite')).toEqual({
      rest: 'xícara de leite',
      hadQuantity: true,
      value: 0.5,
    })
    expect(stripLeadingQuantity('Três quartos de xícara de água')).toEqual({
      rest: 'de xícara de água',
      hadQuantity: true,
      value: 0.75,
    })
  })
  it('decimal com vírgula/ponto', () => {
    expect(stripLeadingQuantity('1,5 kg de batata')).toEqual({
      rest: 'kg de batata',
      hadQuantity: true,
      value: 1.5,
    })
    expect(stripLeadingQuantity('320 g de arroz arbóreo')).toEqual({
      rest: 'g de arroz arbóreo',
      hadQuantity: true,
      value: 320,
    })
  })
  it('sem quantidade-líder ⇒ hadQuantity false, value null, texto intacto', () => {
    expect(stripLeadingQuantity('arroz arbóreo')).toEqual({
      rest: 'arroz arbóreo',
      hadQuantity: false,
      value: null,
    })
    expect(stripLeadingQuantity('folhas de alga nori')).toEqual({
      rest: 'folhas de alga nori',
      hadQuantity: false,
      value: null,
    })
  })
  it('extração do VALOR numérico do líder (todas as formas)', () => {
    expect(stripLeadingQuantity('1/2 xícara de óleo').value).toBe(0.5)
    expect(stripLeadingQuantity('½ xícara de vinho').value).toBe(0.5)
    expect(stripLeadingQuantity('Meia xícara de leite').value).toBe(0.5)
    expect(stripLeadingQuantity('2 dentes de alho').value).toBe(2)
    expect(stripLeadingQuantity('1 e 1/2 xícara de leite').value).toBe(1.5)
  })
})

describe('deterministicStrip — refaz o strip da medida SEM modelo', () => {
  it('contável: tira só o número, MANTÉM a palavra de porção', () => {
    expect(deterministicStrip('4 folhas de alga nori', 'unidade')).toBe('folhas de alga nori')
  })
  it('não-contável: tira número + alias da unidade + conector', () => {
    expect(deterministicStrip('320 g de arroz arbóreo', 'g')).toBe('arroz arbóreo')
    expect(deterministicStrip('2 colheres de sopa de azeite', 'colher_de_sopa')).toBe('azeite')
    expect(deterministicStrip('1/2 xícara de óleo', 'xicara')).toBe('óleo')
    expect(deterministicStrip('1 dente de alho', 'dente')).toBe('alho')
  })
  it('conector ANTES da unidade ("três quartos de xícara de água")', () => {
    expect(deterministicStrip('Três quartos de xícara de água', 'xicara')).toBe('água')
  })
  it('a_gosto/q_b: tira a frase não-mensurável do fim', () => {
    expect(deterministicStrip('sal a gosto', 'a_gosto')).toBe('sal')
    expect(deterministicStrip('fermento q.b.', 'q_b')).toBe('fermento')
  })
})

describe('detectRepair — classifica over-strip | still-embeds | none', () => {
  it('over-strip: o modelo comeu a palavra de porção ⇒ restaura', () => {
    expect(
      detectRepair({ ledgerBefore: '4 folhas de alga nori', current: 'alga nori', quantidade: '4', unidade: 'unidade' }),
    ).toEqual({ kind: 'over-strip', restored: 'folhas de alga nori' })
    expect(
      detectRepair({ ledgerBefore: '1 ramo de tomilho fresco', current: 'tomilho fresco', quantidade: '1', unidade: 'unidade' }),
    ).toEqual({ kind: 'over-strip', restored: 'ramo de tomilho fresco' })
  })
  it("none nas linhas de FRAÇÃO ('1/2 xícara de óleo' → 'óleo'): casa o strip determinístico, NÃO toca", () => {
    expect(
      detectRepair({ ledgerBefore: '1/2 xícara de óleo', current: 'óleo', quantidade: '0.5', unidade: 'xicara' }),
    ).toEqual({ kind: 'none', restored: 'óleo' })
    expect(
      detectRepair({ ledgerBefore: '½ xícara de óleo', current: 'óleo', quantidade: '0.5', unidade: 'xicara' }),
    ).toEqual({ kind: 'none', restored: 'óleo' })
  })
  it('none num strip legítimo (núcleo intacto, sem porção perdida)', () => {
    expect(
      detectRepair({ ledgerBefore: '320 g de arroz arbóreo', current: 'arroz arbóreo', quantidade: '320', unidade: 'g' }),
    ).toEqual({ kind: 'none', restored: 'arroz arbóreo' })
    expect(
      detectRepair({ ledgerBefore: '1 cebola picada', current: 'cebola picada', quantidade: '1', unidade: 'unidade' }),
    ).toEqual({ kind: 'none', restored: 'cebola picada' })
  })
  it('still-embeds numa linha SINALIZADA ("2 dentes de alho fatiados" intacta) ⇒ restaura', () => {
    expect(
      detectRepair({
        ledgerBefore: '2 dentes de alho fatiados',
        current: '2 dentes de alho fatiados',
        quantidade: '2',
        unidade: 'dente',
      }),
    ).toEqual({ kind: 'still-embeds', restored: 'alho fatiados' })
  })
  it('still-embeds sem ledger (vazamento pós-migração) ⇒ restaura do texto atual', () => {
    expect(
      detectRepair({ ledgerBefore: null, current: '200 g de farinha', quantidade: '200', unidade: 'g' }),
    ).toEqual({ kind: 'still-embeds', restored: 'farinha' })
  })
  it('idempotente: já restaurado ⇒ none', () => {
    expect(
      detectRepair({ ledgerBefore: '4 folhas de alga nori', current: 'folhas de alga nori', quantidade: '4', unidade: 'unidade' }),
    ).toEqual({ kind: 'none', restored: 'folhas de alga nori' })
  })

  // ── FIX 1 (data-safety): só trata o número-líder como medida embutida quando ele CORROBORA a medida
  //    estruturada. Um nome que legitimamente começa com número (qty/unidade null, ou número ≠ qty)
  //    NUNCA pode ter o token-líder removido em silêncio.
  it('nome que COMEÇA com número mas SEM medida estruturada ⇒ none (NÃO toca)', () => {
    // "7 grãos" / null / null — "7 grãos" É o nome; não há medida pra vazar.
    expect(
      detectRepair({ ledgerBefore: null, current: '7 grãos', quantidade: null, unidade: null }),
    ).toEqual({ kind: 'none', restored: '7 grãos' })
    // "1 cm de gengibre ralado" / null / null — método 'already-clean' em prod; o "1 cm" é o nome.
    expect(
      detectRepair({ ledgerBefore: null, current: '1 cm de gengibre ralado', quantidade: null, unidade: null }),
    ).toEqual({ kind: 'none', restored: '1 cm de gengibre ralado' })
  })
  it('número-líder que NÃO iguala a quantidade estruturada ⇒ none (não corrobora)', () => {
    // "5 especiarias" / qty 1 — 5 ≠ 1, o "5" faz parte do nome.
    expect(
      detectRepair({ ledgerBefore: null, current: '5 especiarias', quantidade: '1', unidade: 'unidade' }),
    ).toEqual({ kind: 'none', restored: '5 especiarias' })
    // "200 g de 7 grãos" já migrada p/ current "7 grãos" / qty 200 — 7 ≠ 200, "7 grãos" é o nome.
    expect(
      detectRepair({ ledgerBefore: '200 g de 7 grãos', current: '7 grãos', quantidade: '200', unidade: 'g' }),
    ).toEqual({ kind: 'none', restored: '7 grãos' })
  })
  it('número-líder CORROBORA a quantidade estruturada ⇒ still-embeds (vazou ⇒ tira)', () => {
    // "2 dentes de alho fatiados" / qty 2 — 2 == 2, a medida vazou no texto ⇒ limpa.
    expect(
      detectRepair({ ledgerBefore: null, current: '2 dentes de alho fatiados', quantidade: '2', unidade: 'dente' }),
    ).toEqual({ kind: 'still-embeds', restored: 'alho fatiados' })
  })
})

describe('assertCleanName / beginsWithQuantityToken — falha-alto se o nome começa com quantidade', () => {
  it('throws quando começa com fração/glifo/fragmento "e 1/2"', () => {
    expect(() => assertCleanName('1/2 cebola')).toThrow()
    expect(() => assertCleanName('½ xícara de óleo')).toThrow()
    expect(() => assertCleanName('e 1/2 xícara')).toThrow()
  })
  it('passa num nome limpo', () => {
    expect(() => assertCleanName('folhas de alga nori')).not.toThrow()
    expect(() => assertCleanName('alga nori')).not.toThrow()
  })
  it('beginsWithQuantityToken espelha a decisão', () => {
    expect(beginsWithQuantityToken('1/2 cebola')).toBe(true)
    expect(beginsWithQuantityToken('½ xícara')).toBe(true)
    expect(beginsWithQuantityToken('e 1/2 xícara')).toBe(true)
    expect(beginsWithQuantityToken('folhas de alga nori')).toBe(false)
  })
})

describe('headLooksSingular — primeira palavra de conteúdo (NÃO a última)', () => {
  it('singular (não termina em s) ⇒ true', () => {
    expect(headLooksSingular('ovo')).toBe(true)
    expect(headLooksSingular('cebola picada')).toBe(true)
  })
  it('plural na PRIMEIRA palavra ⇒ false', () => {
    expect(headLooksSingular('cebolas')).toBe(false)
    expect(headLooksSingular('gemas de ovo')).toBe(false)
    expect(headLooksSingular('escalopes finos de vitela')).toBe(false)
    expect(headLooksSingular('folhas de alga nori')).toBe(false)
  })
  it('vazio ⇒ false', () => {
    expect(headLooksSingular('')).toBe(false)
    expect(headLooksSingular('   ')).toBe(false)
  })
})
