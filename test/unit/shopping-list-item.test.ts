import { describe, it, expect } from 'vitest'
import {
  computeMatchKey,
  combineQuantidade,
  consolidateIngredientsToAdd,
  isValidItemQuantidade,
  validateAdhocItem,
  SHOPPING_LIST_ITEM_NOME_MAX,
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

// ── Edição à mão (fatia C, #528, ADR-0032 dec.5) ─────────────────────────────────

describe('isValidItemQuantidade', () => {
  it('null é sempre válido (sem quantidade — a_gosto/q.b./avulso sem medida)', () => {
    expect(isValidItemQuantidade(null)).toBe(true)
  })

  it('numeric(10,3)-string positiva é válida', () => {
    expect(isValidItemQuantidade('200')).toBe(true)
    expect(isValidItemQuantidade('2.5')).toBe(true)
    expect(isValidItemQuantidade('0.001')).toBe(true)
  })

  it('zero é INVÁLIDO (não existe "comprar 0" — quem quer limpar usa null)', () => {
    expect(isValidItemQuantidade('0')).toBe(false)
    expect(isValidItemQuantidade('0.000')).toBe(false)
  })

  it('negativo é INVÁLIDO (mais estrito que o regex de geração por IA)', () => {
    expect(isValidItemQuantidade('-1')).toBe(false)
  })

  it('vírgula/não-numérico/formato fora do numeric(10,3) é inválido', () => {
    expect(isValidItemQuantidade('2,5')).toBe(false) // decimal já deve chegar canonicalizado (ponto)
    expect(isValidItemQuantidade('abc')).toBe(false)
    expect(isValidItemQuantidade('')).toBe(false)
    expect(isValidItemQuantidade('1.2345')).toBe(false) // mais de 3 casas
    expect(isValidItemQuantidade('12345678')).toBe(false) // mais de 7 dígitos inteiros
  })
})

describe('validateAdhocItem', () => {
  it('nome obrigatório + quantidade/unidade opcionais (ambas null): ok, nome trimado', () => {
    const v = validateAdhocItem({ nome: '  Guardanapos  ', quantidade: null, unidade: null })
    expect(v).toEqual({ ok: true, nome: 'Guardanapos', quantidade: null, unidade: null })
  })

  it('nome vazio (ou só espaço) ⇒ nome_invalido', () => {
    expect(validateAdhocItem({ nome: '   ', quantidade: null, unidade: null })).toEqual({
      ok: false,
      reason: 'nome_invalido',
    })
  })

  it(`nome acima de ${SHOPPING_LIST_ITEM_NOME_MAX} code points ⇒ nome_invalido`, () => {
    const longo = 'a'.repeat(SHOPPING_LIST_ITEM_NOME_MAX + 1)
    expect(validateAdhocItem({ nome: longo, quantidade: null, unidade: null })).toEqual({
      ok: false,
      reason: 'nome_invalido',
    })
  })

  it('unidade fora do enum ⇒ unidade_invalida', () => {
    expect(validateAdhocItem({ nome: 'Sal', quantidade: null, unidade: 'litro-de-verdade' })).toEqual({
      ok: false,
      reason: 'unidade_invalida',
    })
  })

  it('quantidade fora do formato numeric(10,3) positivo ⇒ quantidade_invalida', () => {
    expect(validateAdhocItem({ nome: 'Sal', quantidade: '0', unidade: null })).toEqual({
      ok: false,
      reason: 'quantidade_invalida',
    })
  })

  it('com quantidade + unidade válidas: ok, devolve os campos', () => {
    expect(validateAdhocItem({ nome: 'Açúcar', quantidade: '2.5', unidade: 'kg' })).toEqual({
      ok: true,
      nome: 'Açúcar',
      quantidade: '2.5',
      unidade: 'kg',
    })
  })
})
