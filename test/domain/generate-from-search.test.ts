import { describe, it, expect } from 'vitest'
import {
  GENERATE_FROM_SEARCH_MIN_LETTERS,
  searchTermGenerability,
} from '@/domain/generate-from-search'

describe('searchTermGenerability', () => {
  it('sem letras ⇒ none (vazio, espaços, só números/pontuação)', () => {
    expect(searchTermGenerability('')).toBe('none')
    expect(searchTermGenerability('   ')).toBe('none')
    expect(searchTermGenerability('123 !?')).toBe('none')
  })

  it(`menos de ${GENERATE_FROM_SEARCH_MIN_LETTERS} letras ⇒ too_short`, () => {
    expect(searchTermGenerability('fr')).toBe('too_short')
    expect(searchTermGenerability(' ovo ')).toBe('too_short')
    // Números não contam como letras.
    expect(searchTermGenerability('pão 2')).toBe('too_short')
  })

  it(`${GENERATE_FROM_SEARCH_MIN_LETTERS}+ letras ⇒ ok (acentos contam como letra)`, () => {
    expect(searchTermGenerability('bolo')).toBe('ok')
    expect(searchTermGenerability('açaí')).toBe('ok')
    expect(searchTermGenerability('feijão tropeiro')).toBe('ok')
  })
})
