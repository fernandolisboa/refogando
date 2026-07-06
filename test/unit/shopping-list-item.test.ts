import { describe, it, expect } from 'vitest'
import {
  computeMatchKey,
  combineQuantidade,
  consolidateIngredientsToAdd,
  type IngredientToAdd,
} from '@/domain/shopping-list-item'

/**
 * Kernel PURO da agregação/merge de Itens da Lista de compras (#526, ADR-0032 dec.2/4) — sem DB,
 * sem I/O. Cobre a chave de agregação (id-ou-nome-normalizado), a soma de quantidade (NULL nunca
 * vira zero) e a consolidação (mesma unidade soma; unidades diferentes separam; nome normalizado
 * mescla "Açúcar"/"acucar").
 */

describe('computeMatchKey', () => {
  it('usa o ingredientId quando presente (ignora o nome)', () => {
    expect(computeMatchKey({ ingredientId: 'abc-123', nome: 'Qualquer coisa' })).toBe('abc-123')
  })

  it('sem ingredientId, usa normalize(nome) — minúsculo, sem acento, trim', () => {
    expect(computeMatchKey({ ingredientId: null, nome: '  Açúcar  ' })).toBe('acucar')
  })

  it('"Açúcar" e "acucar" mesclam sob a MESMA chave', () => {
    const a = computeMatchKey({ ingredientId: null, nome: 'Açúcar' })
    const b = computeMatchKey({ ingredientId: null, nome: 'acucar' })
    expect(a).toBe(b)
  })
})

describe('combineQuantidade', () => {
  it('as duas presentes ⇒ soma', () => {
    expect(combineQuantidade('2.000', '3.500')).toBe('5.5')
  })

  it('as duas ausentes ⇒ ausente (nunca vira zero)', () => {
    expect(combineQuantidade(null, null)).toBeNull()
  })

  it('só uma ausente ⇒ preserva a PRESENTE (não apaga o que já se sabia)', () => {
    expect(combineQuantidade('2.000', null)).toBe('2.000')
    expect(combineQuantidade(null, '2.000')).toBe('2.000')
  })

  it('arredonda a 3 casas (evita ruído de ponto-flutuante)', () => {
    expect(combineQuantidade('0.1', '0.2')).toBe('0.3')
  })
})

describe('consolidateIngredientsToAdd', () => {
  function item(over: Partial<IngredientToAdd> = {}): IngredientToAdd {
    return { ingredientId: null, nome: 'sal', quantidade: null, unidade: null, ...over }
  }

  it('mesmo ingrediente, mesma unidade: soma numa ÚNICA linha', () => {
    const lines = consolidateIngredientsToAdd([
      item({ nome: 'Farinha', quantidade: '200', unidade: 'g' }),
      item({ nome: 'Farinha', quantidade: '100', unidade: 'g' }),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ nome: 'Farinha', quantidade: '300', unidade: 'g' })
  })

  it('mesmo ingrediente, unidades DIFERENTES: linhas SEPARADAS (nunca converte unidade)', () => {
    const lines = consolidateIngredientsToAdd([
      item({ nome: 'Leite', quantidade: '200', unidade: 'ml' }),
      item({ nome: 'Leite', quantidade: '1', unidade: 'l' }),
    ])
    expect(lines).toHaveLength(2)
    const byUnidade = Object.fromEntries(lines.map((l) => [l.unidade, l.quantidade]))
    expect(byUnidade).toEqual({ ml: '200', l: '1' })
  })

  it('"a gosto" (sem número): linha própria, quantidade permanece NULL', () => {
    const lines = consolidateIngredientsToAdd([
      item({ nome: 'Sal', quantidade: null, unidade: 'a_gosto' }),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ quantidade: null, unidade: 'a_gosto' })
  })

  it('duas ocorrências "a gosto" da MESMA chave/unidade: continua UMA linha, quantidade NULL', () => {
    const lines = consolidateIngredientsToAdd([
      item({ nome: 'Sal', quantidade: null, unidade: 'a_gosto' }),
      item({ nome: 'Sal', quantidade: null, unidade: 'a_gosto' }),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].quantidade).toBeNull()
  })

  it('nome normalizado mescla "Açúcar"/"acucar" — mesma linha, quantidade somada', () => {
    const lines = consolidateIngredientsToAdd([
      item({ nome: 'Açúcar', quantidade: '2', unidade: 'colher_de_sopa' }),
      item({ nome: 'acucar', quantidade: '1', unidade: 'colher_de_sopa' }),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].quantidade).toBe('3')
    // primeira ocorrência decide o NOME exibido (surface form gravada no snapshot).
    expect(lines[0].nome).toBe('Açúcar')
  })

  it('ingredientId presente agrega por id MESMO com nomes de superfície diferentes', () => {
    const lines = consolidateIngredientsToAdd([
      item({ ingredientId: 'ing-1', nome: 'Cebola', quantidade: '1', unidade: 'unidade' }),
      item({ ingredientId: 'ing-1', nome: 'Cebola roxa', quantidade: '2', unidade: 'unidade' }),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ matchKey: 'ing-1', quantidade: '3', nome: 'Cebola' })
  })

  it('itens sem nome (vazio após trim) são descartados', () => {
    const lines = consolidateIngredientsToAdd([item({ nome: '   ' })])
    expect(lines).toHaveLength(0)
  })

  it('lista vazia ⇒ nenhuma linha', () => {
    expect(consolidateIngredientsToAdd([])).toEqual([])
  })
})
