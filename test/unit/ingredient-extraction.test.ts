import { describe, expect, it } from 'vitest'
import {
  IngredientExtractionSchema,
  buildExtractionPrompt,
  SYSTEM_PROMPT_EXTRACTION,
  EXTRACTION_MAX_TOKENS,
} from '@/domain/ingredient-extraction'
import { STRENGTHS } from '@/domain/briefing'

/**
 * Domínio PURO da Extração de ingredientes (#112). Sem DB, sem SDK: prova o schema (aceita,
 * rejeita), o prompt determinístico, e as constantes. A normalização de `unidade` (mapear ou
 * descartar) NÃO é testada aqui — ela mora na rota (parse-ingredients), com Postgres real.
 */

describe('IngredientExtractionSchema', () => {
  it('aceita itens bem formados (quantidade/unidade null ou string; strength em STRENGTHS)', () => {
    const parsed = IngredientExtractionSchema.parse({
      items: [
        { rawText: 'cebola', quantidade: '2', unidade: 'unidade', strength: 'required' },
        { rawText: 'salsinha', quantidade: null, unidade: null, strength: 'preferred' },
      ],
    })
    expect(parsed.items).toHaveLength(2)
    expect(parsed.items[0]).toEqual({
      rawText: 'cebola',
      quantidade: '2',
      unidade: 'unidade',
      strength: 'required',
    })
  })

  it('aceita lista de itens vazia', () => {
    expect(IngredientExtractionSchema.parse({ items: [] }).items).toEqual([])
  })

  it('unidade é STRING nullable (NÃO enum): aceita um valor fora do vocabulário sem estourar', () => {
    // Esta é a decisão de robustez de #112: o modelo pode emitir uma unidade desconhecida e
    // o parse NÃO pode falhar — a rota normaliza via isUnidade. Aqui provamos que passa cru.
    const parsed = IngredientExtractionSchema.parse({
      items: [{ rawText: 'leite', quantidade: '1', unidade: 'galao', strength: 'required' }],
    })
    expect(parsed.items[0].unidade).toBe('galao')
  })

  it('rejeita strength fora de STRENGTHS', () => {
    expect(
      IngredientExtractionSchema.safeParse({
        items: [{ rawText: 'sal', quantidade: null, unidade: null, strength: 'opcional' }],
      }).success,
    ).toBe(false)
  })

  it('rejeita quantidade number (deve ser string|null, nunca number)', () => {
    expect(
      IngredientExtractionSchema.safeParse({
        items: [{ rawText: 'arroz', quantidade: 2, unidade: 'xicara', strength: 'required' }],
      }).success,
    ).toBe(false)
  })

  it('rejeita rawText ausente e items ausente', () => {
    expect(
      IngredientExtractionSchema.safeParse({
        items: [{ quantidade: null, unidade: null, strength: 'required' }],
      }).success,
    ).toBe(false)
    expect(IngredientExtractionSchema.safeParse({}).success).toBe(false)
  })
})

describe('buildExtractionPrompt', () => {
  it('é determinístico: systemPrompt fixo + userPrompt = texto trimado', () => {
    const a = buildExtractionPrompt('  2 cebolas, sal a gosto  ')
    const b = buildExtractionPrompt('2 cebolas, sal a gosto')
    expect(a).toEqual(b)
    expect(a.systemPrompt).toBe(SYSTEM_PROMPT_EXTRACTION)
    expect(a.userPrompt).toBe('2 cebolas, sal a gosto')
  })

  it('NÃO injeta nada além do texto do usuário no userPrompt', () => {
    const { userPrompt } = buildExtractionPrompt('só isso')
    expect(userPrompt).toBe('só isso')
  })
})

describe('constantes da Extração', () => {
  it('EXTRACTION_MAX_TOKENS é um teto curto e positivo', () => {
    expect(EXTRACTION_MAX_TOKENS).toBe(1024)
  })

  it('o system prompt enumera os valores snake_case de unidade e instrui null quando desconhecido', () => {
    // Não duplica o vocabulário em código (gate real é isUnidade); aqui só travamos que a
    // prosa CITA os valores canônicos e a instrução de null.
    for (const u of ['colher_de_cha', 'xicara', 'a_gosto', 'q_b']) {
      expect(SYSTEM_PROMPT_EXTRACTION).toContain(u)
    }
    expect(SYSTEM_PROMPT_EXTRACTION.toLowerCase()).toContain('null')
  })

  it('o system prompt instrui a NÃO inventar nem gerar receita', () => {
    expect(SYSTEM_PROMPT_EXTRACTION.toLowerCase()).toContain('nunca invente')
    expect(SYSTEM_PROMPT_EXTRACTION.toLowerCase()).toContain('nunca gere uma receita')
  })

  it('STRENGTHS de briefing.ts é a fonte do enum de strength', () => {
    expect(STRENGTHS).toEqual(['required', 'preferred'])
  })
})
