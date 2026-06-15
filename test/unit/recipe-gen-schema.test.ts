import { describe, expect, it } from 'vitest'
import { RECIPE_GEN_KINDS, RecipeGenSchema } from '@/domain/recipe-gen-schema'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'

// Receita "miolo" completa e válida — base reutilizável nos casos abaixo.
function receitaCompleta(): ReceitaGenT {
  return {
    titulo: 'Risoto de cogumelos',
    descricao: 'Cremoso e reconfortante.',
    passos: ['Refogue a cebola', 'Adicione o arroz', 'Vá pingando o caldo'],
    notas: 'Use caldo quente.',
    originalLocale: 'pt-BR',
    cozinha: 'italiana',
    categoria: 'prato_principal',
    restricoes: ['vegetariano'],
    porcoes: 4,
    dificuldade: 3,
    ingredientes: [
      { rawText: '1 xícara de arroz arbóreo', quantidade: '1', unidade: 'xicara' },
      { rawText: 'cogumelos a gosto', quantidade: null, unidade: 'a_gosto' },
    ],
  }
}

describe('RecipeGenSchema — forma FLAT-OBJECT (§2 fallback)', () => {
  it('aceita um objeto kind:success completo, com receita inteira', () => {
    const parsed = RecipeGenSchema.parse({
      kind: 'success',
      receita: receitaCompleta(),
      advisory: null,
    })
    expect(parsed.kind).toBe('success')
    expect(parsed.receita?.titulo).toBe('Risoto de cogumelos')
    // quantidade trafega como string|null (numeric(10,3) vira string), não number.
    expect(parsed.receita?.ingredientes[0].quantidade).toBe('1')
    expect(parsed.receita?.ingredientes[1].quantidade).toBeNull()
  })

  it('aceita cada um dos 4 kinds com receita PRESENTE', () => {
    for (const kind of RECIPE_GEN_KINDS) {
      const parsed = RecipeGenSchema.parse({
        kind,
        receita: receitaCompleta(),
        advisory: null,
      })
      expect(parsed.kind).toBe(kind)
      expect(parsed.receita).not.toBeNull()
    }
  })

  it('aceita cada um dos 4 kinds com receita NULL (cross-field é regra do app/classify, não do schema)', () => {
    for (const kind of RECIPE_GEN_KINDS) {
      const parsed = RecipeGenSchema.parse({
        kind,
        receita: null,
        advisory: 'algum comentário',
      })
      expect(parsed.kind).toBe(kind)
      expect(parsed.receita).toBeNull()
    }
  })

  it('aceita impossible com receita null (regra de app: impossible ⇒ receita null)', () => {
    const parsed = RecipeGenSchema.parse({
      kind: 'impossible',
      receita: null,
      advisory: 'Não dá pra fazer pizza só com água.',
    })
    expect(parsed.kind).toBe('impossible')
    expect(parsed.receita).toBeNull()
    expect(parsed.advisory).toBe('Não dá pra fazer pizza só com água.')
  })

  it('aceita success com receita null — o schema FLAT não enforça o cross-field (classify enforça)', () => {
    const parsed = RecipeGenSchema.parse({
      kind: 'success',
      receita: null,
      advisory: null,
    })
    expect(parsed.kind).toBe('success')
    expect(parsed.receita).toBeNull()
  })

  it('aceita restricoes vazio e descricao/notas null', () => {
    const receita = receitaCompleta()
    receita.restricoes = []
    receita.descricao = null
    receita.notas = null
    const parsed = RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })
    expect(parsed.receita?.restricoes).toEqual([])
    expect(parsed.receita?.descricao).toBeNull()
    expect(parsed.receita?.notas).toBeNull()
  })

  it('rejeita cozinha fora de COZINHAS', () => {
    const receita = { ...receitaCompleta(), cozinha: 'marciana' }
    expect(() => RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })).toThrow()
  })

  it('rejeita kind fora do enum', () => {
    expect(() =>
      RecipeGenSchema.parse({ kind: 'invalid', receita: null, advisory: null }),
    ).toThrow()
  })

  it('rejeita quantidade numérica (deve ser string|null)', () => {
    const receita = receitaCompleta()
    receita.ingredientes[0] = {
      rawText: '2 xícaras de farinha',
      // número cru viola o contrato string|null
      quantidade: 2 as unknown as string,
      unidade: 'xicara',
    }
    expect(() => RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })).toThrow()
  })

  it('rejeita quantidade string não-numérica ("a gosto" / "2,5" / "")', () => {
    for (const q of ['a gosto', '2,5', '']) {
      const receita = receitaCompleta()
      receita.ingredientes[0] = { rawText: 'algo', quantidade: q, unidade: 'xicara' }
      expect(() =>
        RecipeGenSchema.parse({ kind: 'success', receita, advisory: null }),
      ).toThrow()
    }
  })

  it('aceita quantidade numérica válida ("2.500") e null', () => {
    const receita = receitaCompleta()
    receita.ingredientes = [
      { rawText: '2.5 xícaras', quantidade: '2.500', unidade: 'xicara' },
      { rawText: 'sal a gosto', quantidade: null, unidade: 'a_gosto' },
    ]
    const parsed = RecipeGenSchema.parse({ kind: 'success', receita, advisory: null })
    expect(parsed.receita?.ingredientes[0].quantidade).toBe('2.500')
    expect(parsed.receita?.ingredientes[1].quantidade).toBeNull()
  })
})
