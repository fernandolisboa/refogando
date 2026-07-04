import { describe, expect, it } from 'vitest'
import { FakeClaudeClient } from '@/server/claude/client'
import type { GenerationOutput } from '@/domain/generation'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'

/**
 * `FakeClaudeClient.generateRecipeVariants` (#423) — o dublê devolve o lote enlatado (5º arg do
 * construtor), ignorando axes/cozinhaSlugs como já ignora no single. Estoura se nenhum lote foi passado.
 */

function receita(over: Partial<ReceitaGenT> = {}): ReceitaGenT {
  return {
    titulo: 'Bolo de fubá',
    descricao: null,
    passos: ['Misture', 'Asse'],
    notas: null,
    originalLocale: 'pt-BR',
    cozinha: 'mineira',
    categoria: 'sobremesa',
    restricoes: [],
    porcoes: 8,
    dificuldade: 2,
    ingredientes: [{ nome: 'fubá', quantidade: '2', unidade: 'xicara' }],
    ...over,
  }
}

function variante(variacao: string): GenerationOutput {
  return { kind: 'object', recipe: receita(), advisory: null, modelKind: 'success', variacao }
}

describe('FakeClaudeClient.generateRecipeVariants', () => {
  it('devolve o lote de 2 variações enlatado (ignorando o input)', async () => {
    const canned = [variante('tradicional'), variante('criativa')]
    const fake = new FakeClaudeClient((t) => t, undefined, undefined, undefined, canned)
    const out = await fake.generateRecipeVariants()
    expect(out).toEqual(canned)
    expect(out).toHaveLength(2)
  })

  it('estoura quando nenhum lote foi enlatado (5º arg ausente)', async () => {
    const fake = new FakeClaudeClient()
    await expect(fake.generateRecipeVariants()).rejects.toThrow()
  })

  it('não interfere com generateRecipe (arg posicional preservado)', async () => {
    const single: GenerationOutput = variante('single')
    const fake = new FakeClaudeClient((t) => t, single, undefined, undefined, [variante('a'), variante('b')])
    expect(await fake.generateRecipe()).toEqual(single)
    expect(await fake.generateRecipeVariants()).toHaveLength(2)
  })
})
