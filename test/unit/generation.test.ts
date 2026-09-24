import { describe, expect, it } from 'vitest'
import {
  GENERATION_OUTCOMES,
  classify,
  classifyVariants,
  classifyWithReason,
  type GenerationOutput,
} from '@/domain/generation'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'
import { localeFromTag } from '@/i18n/locale'
import { CREATION_MODES, isCreationMode } from '@/domain/recipe'

// Receita "miolo" válida (faixas in-range) para os branches success|degraded|playful.
// `porcoes`/`dificuldade` dentro de PORCOES {1,50} / DIFICULDADE {1,5}.
function makeReceita(overrides: Partial<ReceitaGenT> = {}): ReceitaGenT {
  return {
    titulo: 'Risoto de funghi',
    descricao: null,
    passos: ['Refogar a cebola', 'Adicionar o arroz'],
    notas: null,
    originalLocale: 'pt-BR',
    cozinha: 'italiana',
    categoria: 'prato_principal',
    restricoes: [],
    porcoes: 4,
    dificuldade: 3,
    ingredientes: [{ nome: 'arroz arbóreo', quantidade: '1', unidade: 'xicara' }],
    ...overrides,
  }
}

describe('classify — kernel puro da taxonomia de geração (#8, §4)', () => {
  it('refusal → {outcome:"invalid"}', () => {
    expect(classify({ kind: 'refusal' })).toEqual({ outcome: 'invalid' })
  })

  it('max_tokens → {outcome:"invalid"}', () => {
    expect(classify({ kind: 'max_tokens' })).toEqual({ outcome: 'invalid' })
  })

  it('parse_failed → {outcome:"invalid"}', () => {
    expect(classify({ kind: 'parse_failed' })).toEqual({ outcome: 'invalid' })
  })

  it('object + modelKind "impossible" → {outcome:"impossible", advisory} (sem recipe)', () => {
    const out: GenerationOutput = {
      kind: 'object',
      recipe: null,
      advisory: 'Não dá para fazer bolo sem nenhum ingrediente.',
      modelKind: 'impossible',
    }
    const result = classify(out)
    expect(result).toEqual({
      outcome: 'impossible',
      advisory: 'Não dá para fazer bolo sem nenhum ingrediente.',
    })
    // O branch impossible NÃO carrega recipe.
    expect(result).not.toHaveProperty('recipe')
  })

  it('object + "impossible" com advisory null ainda classifica como impossible', () => {
    expect(
      classify({ kind: 'object', recipe: null, advisory: null, modelKind: 'impossible' }),
    ).toEqual({ outcome: 'impossible', advisory: null })
  })

  it('object + "success" (faixas válidas) → {outcome:"success", recipe, advisory}', () => {
    const recipe = makeReceita()
    const out: GenerationOutput = {
      kind: 'object',
      recipe,
      advisory: 'Use queijo parmesão fresco.',
      modelKind: 'success',
    }
    expect(classify(out)).toEqual({
      outcome: 'success',
      recipe,
      advisory: 'Use queijo parmesão fresco.',
    })
  })

  it('object + "degraded" (faixas válidas) → {outcome:"degraded", recipe, advisory}', () => {
    const recipe = makeReceita()
    const out: GenerationOutput = {
      kind: 'object',
      recipe,
      advisory: null,
      modelKind: 'degraded',
    }
    expect(classify(out)).toEqual({ outcome: 'degraded', recipe, advisory: null })
  })

  it('object + "playful" (faixas válidas) → {outcome:"playful", recipe, advisory}', () => {
    const recipe = makeReceita()
    const out: GenerationOutput = {
      kind: 'object',
      recipe,
      advisory: 'Receita divertida — não leve a sério.',
      modelKind: 'playful',
    }
    expect(classify(out)).toEqual({
      outcome: 'playful',
      recipe,
      advisory: 'Receita divertida — não leve a sério.',
    })
  })

  it('faixas nos limites (porcoes=1/50, dificuldade=1/5) são válidas', () => {
    const baixo = classify({
      kind: 'object',
      recipe: makeReceita({ porcoes: 1, dificuldade: 1 }),
      advisory: null,
      modelKind: 'success',
    })
    expect(baixo.outcome).toBe('success')
    const alto = classify({
      kind: 'object',
      recipe: makeReceita({ porcoes: 50, dificuldade: 5 }),
      advisory: null,
      modelKind: 'success',
    })
    expect(alto.outcome).toBe('success')
  })

  it('object + "success" com porcoes fora de faixa (99) → invalid (NÃO clampa)', () => {
    const out: GenerationOutput = {
      kind: 'object',
      recipe: makeReceita({ porcoes: 99 }),
      advisory: 'qualquer coisa',
      modelKind: 'success',
    }
    expect(classify(out)).toEqual({ outcome: 'invalid' })
  })

  it('object + "success" com porcoes abaixo da faixa (0) → invalid', () => {
    expect(
      classify({
        kind: 'object',
        recipe: makeReceita({ porcoes: 0 }),
        advisory: null,
        modelKind: 'success',
      }),
    ).toEqual({ outcome: 'invalid' })
  })

  it('object + "success" com dificuldade fora de faixa (9) → invalid (NÃO clampa)', () => {
    const out: GenerationOutput = {
      kind: 'object',
      recipe: makeReceita({ dificuldade: 9 }),
      advisory: null,
      modelKind: 'success',
    }
    expect(classify(out)).toEqual({ outcome: 'invalid' })
  })

  it('object + "playful" com dificuldade fora de faixa também → invalid', () => {
    expect(
      classify({
        kind: 'object',
        recipe: makeReceita({ dificuldade: 0 }),
        advisory: null,
        modelKind: 'playful',
      }),
    ).toEqual({ outcome: 'invalid' })
  })

  it('object + "success" com recipe null (viola contrato) → invalid', () => {
    expect(
      classify({ kind: 'object', recipe: null, advisory: null, modelKind: 'success' }),
    ).toEqual({ outcome: 'invalid' })
  })

  it('quantidade "a gosto" (não-numérica) num ingrediente → invalid (NÃO chega ao DB)', () => {
    const recipe = makeReceita({
      ingredientes: [{ nome: 'sal', quantidade: 'a gosto', unidade: 'a_gosto' }],
    })
    expect(
      classify({ kind: 'object', recipe, advisory: null, modelKind: 'success' }),
    ).toEqual({ outcome: 'invalid' })
  })

  it('quantidade "2,5" (vírgula-decimal) → invalid', () => {
    const recipe = makeReceita({
      ingredientes: [{ nome: 'farinha', quantidade: '2,5', unidade: 'xicara' }],
    })
    expect(
      classify({ kind: 'object', recipe, advisory: null, modelKind: 'success' }),
    ).toEqual({ outcome: 'invalid' })
  })

  it('quantidade "" (string vazia) → invalid', () => {
    const recipe = makeReceita({
      ingredientes: [{ nome: 'arroz', quantidade: '', unidade: 'xicara' }],
    })
    expect(
      classify({ kind: 'object', recipe, advisory: null, modelKind: 'success' }),
    ).toEqual({ outcome: 'invalid' })
  })

  it('quantidade numérica válida ("2.500") e null preservam o outcome do modelo', () => {
    const recipe = makeReceita({
      ingredientes: [
        { nome: 'farinha', quantidade: '2.500', unidade: 'xicara' },
        { nome: 'sal', quantidade: null, unidade: 'a_gosto' },
      ],
    })
    expect(
      classify({ kind: 'object', recipe, advisory: null, modelKind: 'success' }),
    ).toEqual({ outcome: 'success', recipe, advisory: null })
  })

  it.each(['', 'xx', 'es'])(
    'originalLocale %j (não reconhecido) → cai no DEFAULT_LOCALE, NÃO falha a geração',
    (raw) => {
      const recipe = makeReceita({ originalLocale: raw })
      const result = classify({ kind: 'object', recipe, advisory: null, modelKind: 'success' })
      expect(result.outcome).toBe('success')
      if (result.outcome === 'success') expect(result.recipe.originalLocale).toBe('pt-BR')
    },
  )

  it('originalLocale suportado ("en-US") preserva o outcome do modelo', () => {
    const recipe = makeReceita({ originalLocale: 'en-US' })
    expect(
      classify({ kind: 'object', recipe, advisory: 'nota', modelKind: 'degraded' }),
    ).toEqual({ outcome: 'degraded', recipe, advisory: 'nota' })
  })
})

describe('classifyWithReason — motivo do invalid (só metadado, sem conteúdo)', () => {
  it('porcoes fora da faixa → motivo nomeia a regra', () => {
    const recipe = makeReceita({ porcoes: 0 })
    expect(
      classifyWithReason({ kind: 'object', recipe, advisory: null, modelKind: 'success' }).reason,
    ).toBe('porcoes fora da faixa: 0')
  })

  it('saída não-object → motivo é o kind do seam', () => {
    expect(classifyWithReason({ kind: 'max_tokens' }).reason).toBe('max_tokens')
  })

  it('válida → reason null e result igual ao de classify', () => {
    const recipe = makeReceita()
    const out: GenerationOutput = { kind: 'object', recipe, advisory: null, modelKind: 'success' }
    expect(classifyWithReason(out)).toEqual({ result: classify(out), reason: null })
  })
})

describe('localeFromTag — locale da saída do modelo → suportado canônico', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['en-US', 'en-US'],
    ['EN-us', 'en-US'],
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['en_GB', 'en-US'],
    ['pt', 'pt-BR'],
    ['pt-PT', 'pt-BR'],
    [' en ', 'en-US'],
  ])('%j → %s', (raw, expected) => {
    expect(localeFromTag(raw)).toBe(expected)
  })

  it.each(['', '  ', 'xx', 'es', 'es-ES'])('%j → null', (raw) => {
    expect(localeFromTag(raw)).toBeNull()
  })

  it("classify de uma Receita com 'en' persiste 'en-US' (não 502)", () => {
    const recipe = makeReceita({ originalLocale: 'en' })
    const result = classify({ kind: 'object', recipe, advisory: null, modelKind: 'success' })
    expect(result.outcome).toBe('success')
    if (result.outcome === 'success') expect(result.recipe.originalLocale).toBe('en-US')
  })
})

describe('classifyVariants — lote "gerar 2, o usuário escolhe" (#423)', () => {
  function objVar(variacao: string, over: Partial<GenerationOutput & { modelKind: string }> = {}): GenerationOutput {
    return { kind: 'object', recipe: makeReceita(), advisory: null, modelKind: 'success', variacao, ...over } as GenerationOutput
  }

  it('2 variações válidas → 2 resultados, cada um com o rótulo do pólo', () => {
    const out = classifyVariants([objVar('tradicional'), objVar('criativa', { modelKind: 'degraded', advisory: 'troquei X' })])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ outcome: 'success', variacao: 'tradicional' })
    expect(out[1]).toMatchObject({ outcome: 'degraded', variacao: 'criativa', advisory: 'troquei X' })
    expect(out[0].recipe.titulo).toBe('Risoto de funghi')
  })

  it('1 inválida (porcoes fora de faixa) → FILTRA, sobra 1', () => {
    const ruim = objVar('ruim', { recipe: makeReceita({ porcoes: 99 }) })
    const out = classifyVariants([objVar('boa'), ruim])
    expect(out).toHaveLength(1)
    expect(out[0].variacao).toBe('boa')
  })

  it('impossible NÃO conta como variação escolhível (sem Receita) → filtrada', () => {
    const imp: GenerationOutput = { kind: 'object', recipe: null, advisory: 'nope', modelKind: 'impossible', variacao: 'x' }
    const out = classifyVariants([objVar('boa'), imp])
    expect(out).toHaveLength(1)
    expect(out[0].variacao).toBe('boa')
  })

  it('lote com parse_failed (batch falhou) → [] (a borda 502a)', () => {
    expect(classifyVariants([{ kind: 'parse_failed' }])).toEqual([])
    expect(classifyVariants([])).toEqual([])
  })

  it('variacao ausente no output vira string vazia (defensivo)', () => {
    const semLabel: GenerationOutput = { kind: 'object', recipe: makeReceita(), advisory: null, modelKind: 'success' }
    const out = classifyVariants([semLabel, objVar('b')])
    expect(out[0].variacao).toBe('')
  })
})

describe('GENERATION_OUTCOMES — taxonomia de 5 valores (alimenta o pgEnum)', () => {
  it('contém exatamente success/degraded/playful/impossible/invalid', () => {
    expect(GENERATION_OUTCOMES).toEqual([
      'success',
      'degraded',
      'playful',
      'impossible',
      'invalid',
    ])
  })
})

describe('CREATION_MODES / isCreationMode — guard de modo de criação', () => {
  it('CREATION_MODES é conversation/structured/free_text', () => {
    expect(CREATION_MODES).toEqual(['conversation', 'structured', 'free_text'])
  })

  it('isCreationMode: pertencimento', () => {
    for (const m of CREATION_MODES) expect(isCreationMode(m)).toBe(true)
    expect(isCreationMode('conversation')).toBe(true)
    expect(isCreationMode('structured')).toBe(true)
    expect(isCreationMode('telepatia')).toBe(false)
    expect(isCreationMode('')).toBe(false)
  })
})
