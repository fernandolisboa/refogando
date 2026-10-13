import { describe, it, expect } from 'vitest'
import {
  MAX_PANTRY_ADD_BATCH,
  MAX_PANTRY_BASICS,
  MAX_PANTRY_ITEMS,
  PANTRY_BASICS,
  PANTRY_NAME_MAX,
  pantryMatchKey,
  parsePantryBasics,
  parsePantryName,
  parsePantryRestore,
  resolvePantryBasics,
  splitCookedPantryItems,
  splitPantryInput,
  splitPantryMatches,
} from '@/domain/pantry'

/**
 * Kernel PURO da Despensa (ADR-0038): o nome gravado é limpo e limitado; a chave de dedup ignora caixa,
 * acento e pontuação; o campo aceita vários nomes; os básicos são nomes inequívocos.
 */

describe('parsePantryName', () => {
  it('normaliza espaços, tira invisíveis e marcas bidi, mantém a caixa', () => {
    expect(parsePantryName('  Queijo​   minas ‮fresco ')).toBe('Queijo minas fresco')
  })
  it('rejeita vazio, longo demais, não-string e nome sem letra nem dígito', () => {
    expect(parsePantryName('   ')).toBe('invalid')
    expect(parsePantryName('x'.repeat(PANTRY_NAME_MAX + 1))).toBe('invalid')
    expect(parsePantryName('x'.repeat(PANTRY_NAME_MAX))).toBe('x'.repeat(PANTRY_NAME_MAX))
    expect(parsePantryName(42)).toBe('invalid')
    expect(parsePantryName('---')).toBe('invalid')
  })
  it('conta por code point (emoji = 1)', () => {
    const name = 'ovo' + '🥚'.repeat(PANTRY_NAME_MAX - 3)
    expect(parsePantryName(name)).toBe(name)
    expect(parsePantryName(name + '🥚')).toBe('invalid')
  })
})

describe('pantryMatchKey', () => {
  it('ignora caixa, acento e pontuação', () => {
    expect(pantryMatchKey('Pimenta-do-Reino')).toBe('pimenta do reino')
    expect(pantryMatchKey('FEIJÃO')).toBe('feijao')
    expect(pantryMatchKey('açúcar  (refinado)')).toBe('acucar refinado')
  })
})

describe('splitPantryInput', () => {
  it('separa por vírgula, ponto e vírgula e quebra de linha; ignora pedaços vazios; deduplica', () => {
    expect(splitPantryInput('ovo, Tomate;;\nqueijo, OVO,')).toEqual(['ovo', 'Tomate', 'queijo'])
  })
  it('aceita lista de strings', () => {
    expect(splitPantryInput(['arroz', 'feijão, alho'])).toEqual(['arroz', 'feijão', 'alho'])
  })
  it('um pedaço inválido invalida tudo (nada é gravado pela metade)', () => {
    expect(splitPantryInput(`ovo, ${'x'.repeat(PANTRY_NAME_MAX + 1)}`)).toBe('invalid')
    expect(splitPantryInput(' , ; ')).toBe('invalid')
    expect(splitPantryInput(null)).toBe('invalid')
    expect(splitPantryInput([1])).toBe('invalid')
  })
  it('teto de nomes por vez', () => {
    const many = Array.from({ length: MAX_PANTRY_ADD_BATCH + 1 }, (_, i) => `item ${i}`).join(',')
    expect(splitPantryInput(many)).toBe('too_many')
  })
})

describe('básicos', () => {
  it('só nomes inequívocos: nada de "pimenta" nem "oil" sozinhos', () => {
    expect(PANTRY_BASICS).toContain('sal')
    expect(PANTRY_BASICS).toContain('salt')
    expect(PANTRY_BASICS).not.toContain('pimenta')
    expect(PANTRY_BASICS).not.toContain('oil')
  })
})

describe('splitPantryMatches', () => {
  it('nada faltando ⇒ pronto; o resto ⇒ falta pouco, mantendo a ordem', () => {
    const a = { id: 'a', total: 3, covered: 3, missing: [] }
    const b = { id: 'b', total: 4, covered: 3, missing: ['x'] }
    const c = { id: 'c', total: 2, covered: 2, missing: [] }
    expect(splitPantryMatches([a, b, c])).toEqual({
      ready: [a, c],
      almost: [b],
    })
  })
})

describe('básicos por pessoa (ADR-0042)', () => {
  it('nunca mexeu (null/undefined) ⇒ a lista padrão, a MESMA referência; lista vazia vale como vazia', () => {
    expect(resolvePantryBasics(null)).toBe(PANTRY_BASICS)
    expect(resolvePantryBasics(undefined)).toBe(PANTRY_BASICS)
    expect(resolvePantryBasics([])).toEqual([])
    expect(resolvePantryBasics(['alho'])).toEqual(['alho'])
  })

  it('parsePantryBasics: limpa cada nome, deduplica pela chave e aceita lista vazia', () => {
    expect(parsePantryBasics(['  Sal ', 'sal', 'Pimenta-do-Reino', 'pimenta do reino', 'alho'])).toEqual([
      'Sal',
      'Pimenta-do-Reino',
      'alho',
    ])
    expect(parsePantryBasics([])).toEqual([])
  })

  it('parsePantryBasics: um elemento é UM nome (vírgula não separa)', () => {
    expect(parsePantryBasics(['sal, pimenta'])).toEqual(['sal, pimenta'])
  })

  it('parsePantryBasics: não-array, nome inválido e acima do teto', () => {
    expect(parsePantryBasics('sal')).toBe('invalid')
    expect(parsePantryBasics(null)).toBe('invalid')
    expect(parsePantryBasics(['sal', 42])).toBe('invalid')
    expect(parsePantryBasics(['sal', '---'])).toBe('invalid')
    expect(parsePantryBasics(['x'.repeat(PANTRY_NAME_MAX + 1)])).toBe('invalid')
    const max = Array.from({ length: MAX_PANTRY_BASICS }, (_, i) => `b${i}`)
    expect(parsePantryBasics(max)).toHaveLength(MAX_PANTRY_BASICS)
    expect(parsePantryBasics([...max, 'mais um'])).toBe('too_many')
  })

  it('a lista padrão cabe no teto e passa na própria validação', () => {
    expect(parsePantryBasics([...PANTRY_BASICS])).toEqual(PANTRY_BASICS)
  })
})

describe('"Cozinhei" (ADR-0042)', () => {
  const items = [
    { id: 'i-farinha', nome: 'farinha' },
    { id: 'i-leite', nome: 'leite' },
    { id: 'i-ovo', nome: 'Ovo' },
    { id: 'i-pimenta', nome: 'pimenta do reino' },
    { id: 'i-sal', nome: 'Sal' },
  ]

  it('tira só o que o casamento usou; básicos (pela chave: caixa, acento, pontuação) ficam', () => {
    const used = ['i-farinha', 'i-ovo', 'i-sal', 'i-pimenta']
    const { remove, keptBasics } = splitCookedPantryItems(items, used, PANTRY_BASICS)
    expect(remove.map((i) => i.id)).toEqual(['i-farinha', 'i-ovo'])
    // "Sal" casa o básico "sal"; "pimenta do reino" casa "pimenta-do-reino".
    expect(keptBasics.map((i) => i.id)).toEqual(['i-pimenta', 'i-sal'])
  })

  it('usa os básicos DA PESSOA: farinha como básico fica; sal fora da lista dela sai', () => {
    const { remove, keptBasics } = splitCookedPantryItems(items, ['i-farinha', 'i-sal'], ['Farinha'])
    expect(remove.map((i) => i.id)).toEqual(['i-sal'])
    expect(keptBasics.map((i) => i.id)).toEqual(['i-farinha'])
  })

  it('nada usado ⇒ nada sai (o segundo toque, com os itens já fora, também)', () => {
    expect(splitCookedPantryItems(items, [], PANTRY_BASICS)).toEqual({ remove: [], keptBasics: [] })
    expect(splitCookedPantryItems([], ['i-ovo'], PANTRY_BASICS)).toEqual({ remove: [], keptBasics: [] })
  })

  it('o desfazer devolve exatamente os nomes que saíram, um por elemento (vírgula não separa)', () => {
    expect(parsePantryRestore(['Ovo', 'farinha', 'sal, pimenta'])).toEqual(['Ovo', 'farinha', 'sal, pimenta'])
  })

  it('o desfazer recusa vazio, não-array, nome inválido e mais que a Despensa inteira', () => {
    expect(parsePantryRestore([])).toBe('invalid')
    expect(parsePantryRestore('ovo')).toBe('invalid')
    expect(parsePantryRestore(['ovo', 'x'.repeat(PANTRY_NAME_MAX + 1)])).toBe('invalid')
    expect(parsePantryRestore(Array.from({ length: MAX_PANTRY_ITEMS + 1 }, (_, i) => `i${i}`))).toBe('invalid')
    expect(parsePantryRestore(Array.from({ length: MAX_PANTRY_ITEMS }, (_, i) => `i${i}`))).toHaveLength(
      MAX_PANTRY_ITEMS,
    )
  })
})
