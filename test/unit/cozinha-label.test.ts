import { describe, expect, it } from 'vitest'
import {
  pickCozinhaLabel,
  localizeCozinhaVocab,
  resolveCozinhaLabel,
} from '@/domain/cozinha-label'
import type { ReadonlyVocabulary } from '@/server/vocabulary/load'

/**
 * Rótulos de cozinha vindos do leitor data-driven (#317, ADR-0025). PURO — sem DB.
 * Prova a cadeia de fallback de locale (rótulo-do-locale → rótulo-do-outro → slug), a
 * preservação de ordem ao localizar o vocabulário e a resolução de UM slug gravado.
 */

describe('pickCozinhaLabel: cadeia de fallback de locale', () => {
  it('pt-BR: usa labelPtBr quando presente', () => {
    expect(
      pickCozinhaLabel({ slug: 'brasileira', labelPtBr: 'Brasileira', labelEnUs: 'Brazilian' }, 'pt-BR'),
    ).toBe('Brasileira')
  })

  it('en-US: usa labelEnUs quando presente', () => {
    expect(
      pickCozinhaLabel({ slug: 'brasileira', labelPtBr: 'Brasileira', labelEnUs: 'Brazilian' }, 'en-US'),
    ).toBe('Brazilian')
  })

  it('pt-BR com labelPtBr nulo cai no labelEnUs (rótulo do outro locale)', () => {
    expect(
      pickCozinhaLabel({ slug: 'fusion', labelPtBr: null, labelEnUs: 'Fusion' }, 'pt-BR'),
    ).toBe('Fusion')
  })

  it('en-US com labelEnUs nulo cai no labelPtBr (rótulo do outro locale)', () => {
    expect(
      pickCozinhaLabel({ slug: 'caipira', labelPtBr: 'Caipira', labelEnUs: null }, 'en-US'),
    ).toBe('Caipira')
  })

  it('ambos nulos caem no slug cru (nunca string vazia)', () => {
    expect(
      pickCozinhaLabel({ slug: 'novacozinha', labelPtBr: null, labelEnUs: null }, 'pt-BR'),
    ).toBe('novacozinha')
  })
})

describe('localizeCozinhaVocab: ordem preservada + locale aplicado', () => {
  const vocab: ReadonlyVocabulary = [
    { slug: 'italiana', labelPtBr: 'Italiana', labelEnUs: 'Italian', sort: 0 },
    { slug: 'brasileira', labelPtBr: 'Brasileira', labelEnUs: 'Brazilian', sort: 1 },
    { slug: 'novacozinha', labelPtBr: null, labelEnUs: null, sort: 2 },
  ]

  it('mapeia para {value,label} preservando a ordem do leitor (pt-BR)', () => {
    expect(localizeCozinhaVocab(vocab, 'pt-BR')).toEqual([
      { value: 'italiana', label: 'Italiana' },
      { value: 'brasileira', label: 'Brasileira' },
      { value: 'novacozinha', label: 'novacozinha' },
    ])
  })

  it('aplica o locale en-US a cada rótulo', () => {
    expect(localizeCozinhaVocab(vocab, 'en-US')).toEqual([
      { value: 'italiana', label: 'Italian' },
      { value: 'brasileira', label: 'Brazilian' },
      { value: 'novacozinha', label: 'novacozinha' },
    ])
  })
})

describe('resolveCozinhaLabel: rótulo de UM slug gravado', () => {
  const options = [
    { value: 'brasileira', label: 'Brasileira' },
    { value: 'mexicana', label: 'Mexicana' },
  ]

  it('slug presente → rótulo localizado', () => {
    expect(resolveCozinhaLabel(options, 'mexicana')).toBe('Mexicana')
  })

  it('slug ausente do escopo → o próprio slug cru (defensivo)', () => {
    expect(resolveCozinhaLabel(options, 'depreciada')).toBe('depreciada')
  })

  it('slug null → null (faceta ausente, nada a renderizar)', () => {
    expect(resolveCozinhaLabel(options, null)).toBeNull()
  })
})
