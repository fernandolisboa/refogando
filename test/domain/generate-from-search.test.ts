import { describe, it, expect } from 'vitest'
import {
  GENERATE_FROM_SEARCH_MIN_LETTERS,
  createFromSearchHref,
  searchTermReadiness,
} from '@/domain/generate-from-search'

describe('searchTermReadiness', () => {
  it('sem letras ⇒ none (vazio, espaços, só números/pontuação)', () => {
    expect(searchTermReadiness('')).toBe('none')
    expect(searchTermReadiness('   ')).toBe('none')
    expect(searchTermReadiness('123 !?')).toBe('none')
  })

  it(`menos de ${GENERATE_FROM_SEARCH_MIN_LETTERS} letras ⇒ too_short`, () => {
    expect(searchTermReadiness('fr')).toBe('too_short')
    expect(searchTermReadiness(' ovo ')).toBe('too_short')
    // Números não contam como letras.
    expect(searchTermReadiness('pão 2')).toBe('too_short')
  })

  it(`${GENERATE_FROM_SEARCH_MIN_LETTERS}+ letras ⇒ ok (acentos contam como letra)`, () => {
    expect(searchTermReadiness('bolo')).toBe('ok')
    expect(searchTermReadiness('açaí')).toBe('ok')
    expect(searchTermReadiness('feijão tropeiro')).toBe('ok')
  })
})

describe('createFromSearchHref', () => {
  it('termo que serve de pedido ⇒ /create?q=<termo aparado, URL-encoded>', () => {
    expect(createFromSearchHref('  feijão tropeiro ')).toBe('/create?q=feij%C3%A3o%20tropeiro')
  })

  it('sem termo utilizável ⇒ /create cru (sem ?q= espúrio nem "123" pré-preenchido)', () => {
    expect(createFromSearchHref('')).toBe('/create')
    expect(createFromSearchHref('123')).toBe('/create')
    expect(createFromSearchHref('fr')).toBe('/create')
  })
})
