import { describe, it, expect } from 'vitest'
import {
  MAX_PANTRY_ADD_BATCH,
  PANTRY_BASICS,
  PANTRY_NAME_MAX,
  pantryMatchKey,
  parsePantryName,
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
