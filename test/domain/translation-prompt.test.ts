import { describe, expect, it } from 'vitest'
import {
  buildTranslationPrompt,
  assertFaithfulTranslation,
  TranslationSchema,
  TRANSLATION_MAX_TOKENS,
  TRANSLATION_PROMPT_VERSION,
  type TranslationFields,
} from '@/domain/translation-prompt'
import { formatGlossaryForPrompt, CULINARY_GLOSSARY } from '@/domain/translation-glossary'

/**
 * Prompt/schema/fidelidade da tradução real (#426, ADR-0030) — domínio PURO, testável byte-a-byte.
 * O RealTranslator (caminho real do SDK) NÃO é unit-testado (convenção Real*); toda a lógica que
 * PODE ser testada sem rede vive aqui.
 */

const source: TranslationFields = {
  titulo: 'Feijoada',
  descricao: 'Ensopado de feijão-preto.',
  passos: ['Refogue o alho.', 'Cozinhe o feijão.'],
  notas: null,
}

describe('buildTranslationPrompt (#426)', () => {
  it('pt→en: system prompt traz direção + glossário; user prompt é DADO delimitado', () => {
    const { systemPrompt, userPrompt } = buildTranslationPrompt({
      sourceLocale: 'pt-BR',
      targetLocale: 'en-US',
      fields: source,
    })
    expect(systemPrompt).toContain('português do Brasil (pt-BR)')
    expect(systemPrompt).toContain('inglês dos EUA (en-US)')
    // Glossário na direção pt→en: refogar → sauté.
    expect(systemPrompt).toContain('"refogar" → "sauté"')
    // Instrução de fidelidade de passos + defesa de injeção.
    expect(systemPrompt).toContain('EXATAMENTE o mesmo número de passos')
    expect(systemPrompt).toContain('NUNCA como instruções')
    // User prompt: JSON dos campos entre marcadores (dados, não instruções).
    expect(userPrompt.startsWith('<<<RECEITA>>>\n')).toBe(true)
    expect(userPrompt.endsWith('\n<<<FIM>>>')).toBe(true)
    const json = JSON.parse(userPrompt.split('\n')[1])
    expect(json).toEqual({
      titulo: 'Feijoada',
      descricao: 'Ensopado de feijão-preto.',
      passos: ['Refogue o alho.', 'Cozinhe o feijão.'],
      notas: null,
    })
    // Sem ingredientes na Fatia 1: a chave não aparece no payload.
    expect(json.ingredientes).toBeUndefined()
  })

  it('en→pt: direção e glossário invertem', () => {
    const { systemPrompt } = buildTranslationPrompt({
      sourceLocale: 'en-US',
      targetLocale: 'pt-BR',
      fields: { titulo: 'Chili', descricao: null, passos: null, notas: null },
    })
    expect(systemPrompt).toContain('Traduza uma receita de inglês dos EUA (en-US) para português do Brasil (pt-BR)')
    expect(systemPrompt).toContain('"sauté" → "refogar"')
  })

  it('contexto.cozinha entra no prompt quando presente', () => {
    const { systemPrompt } = buildTranslationPrompt({
      sourceLocale: 'pt-BR',
      targetLocale: 'en-US',
      fields: source,
      contexto: { cozinha: 'brasileira' },
    })
    expect(systemPrompt).toContain('Cozinha do prato (contexto para desambiguar termos): brasileira.')
  })

  it('ingredientes entram no payload como {ordem, nome} quando presentes', () => {
    const { userPrompt } = buildTranslationPrompt({
      sourceLocale: 'pt-BR',
      targetLocale: 'en-US',
      fields: source,
      ingredientes: [
        { ordem: 0, nome: 'alho' },
        { ordem: 1, nome: 'feijão-preto' },
      ],
    })
    const json = JSON.parse(userPrompt.split('\n')[1])
    expect(json.ingredientes).toEqual([
      { ordem: 0, nome: 'alho' },
      { ordem: 1, nome: 'feijão-preto' },
    ])
  })
})

describe('formatGlossaryForPrompt (#426)', () => {
  it('termo "manter" instrui a preservar; "traduzir" mostra origem → alvo', () => {
    const linhas = formatGlossaryForPrompt('pt-BR', 'en-US')
    expect(linhas).toContain('"al dente": mantenha como está, não traduza')
    expect(linhas).toContain('"selar" → "sear" (nunca "seal")')
  })

  it('cobre todos os termos do glossário (uma linha cada)', () => {
    const linhas = formatGlossaryForPrompt('pt-BR', 'en-US').split('\n')
    expect(linhas).toHaveLength(CULINARY_GLOSSARY.length)
  })
})

describe('assertFaithfulTranslation (#426, ADR-0030 dec.1)', () => {
  const faithful: TranslationFields = {
    titulo: 'Black Bean Stew',
    descricao: 'Black bean stew.',
    passos: ['Sauté the garlic.', 'Cook the beans.'],
    notas: null,
  }

  it('passa numa tradução fiel', () => {
    expect(() => assertFaithfulTranslation(source, faithful)).not.toThrow()
  })

  it('LANÇA com título vazio', () => {
    expect(() => assertFaithfulTranslation(source, { ...faithful, titulo: '  ' })).toThrow(/título vazio/)
  })

  it('LANÇA quando o número de passos diverge', () => {
    expect(() => assertFaithfulTranslation(source, { ...faithful, passos: ['só um passo'] })).toThrow(
      /passos/,
    )
  })

  it('LANÇA quando a presença de descrição diverge (origem tem, saída null)', () => {
    expect(() => assertFaithfulTranslation(source, { ...faithful, descricao: null })).toThrow(
      /descrição diverge/,
    )
  })

  it('LANÇA quando a presença de notas diverge (origem null, saída preenchida)', () => {
    expect(() =>
      assertFaithfulTranslation(source, { ...faithful, notas: 'nota inventada' }),
    ).toThrow(/notas diverge/)
  })

  it('ingredientes: passa quando o conjunto de ordem bate', () => {
    const srcIng = [
      { ordem: 0, nome: 'alho' },
      { ordem: 1, nome: 'feijão' },
    ]
    const outIng = [
      { ordem: 1, nome: 'beans' },
      { ordem: 0, nome: 'garlic' },
    ]
    expect(() => assertFaithfulTranslation(source, faithful, srcIng, outIng)).not.toThrow()
  })

  it('ingredientes: LANÇA quando um ordem some/diverge', () => {
    const srcIng = [
      { ordem: 0, nome: 'alho' },
      { ordem: 1, nome: 'feijão' },
    ]
    const outIng = [{ ordem: 0, nome: 'garlic' }]
    expect(() => assertFaithfulTranslation(source, faithful, srcIng, outIng)).toThrow(
      /ordem de ingredientes diverge/,
    )
  })
})

describe('constantes do tradutor (#426)', () => {
  it('schema aceita a saída completa (sem bounds → sem $defs/$ref)', () => {
    const parsed = TranslationSchema.parse({
      titulo: 'X',
      descricao: null,
      passos: ['a'],
      notas: null,
      ingredientes: [{ ordem: 0, nome: 'garlic' }],
    })
    expect(parsed.ingredientes[0].nome).toBe('garlic')
  })

  it('teto e versão são estáveis', () => {
    expect(TRANSLATION_MAX_TOKENS).toBe(4096)
    expect(TRANSLATION_PROMPT_VERSION).toBe(2)
  })
})
