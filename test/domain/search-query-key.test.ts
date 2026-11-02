import { describe, expect, it } from 'vitest'
import { canonicalSearchQuery, embeddableSearchQuery } from '@/domain/search-query-key'

/** Forma canônica da consulta que vira vetor e chave do cache (#643, ADR-0057). */
describe('canonicalSearchQuery', () => {
  it('minúsculas, espaços colapsados e pontas aparadas', () => {
    expect(canonicalSearchQuery('  Frango \t com\n\nQUIABO  ', 256)).toBe('frango com quiabo')
  })

  it('NFKC: forma composta e compatibilidade viram a mesma consulta', () => {
    const decomposta = 'pão' // "pão" com o til combinante
    expect(canonicalSearchQuery(decomposta, 256)).toBe(canonicalSearchQuery('pão', 256))
    expect(canonicalSearchQuery('ＦＥＩＪＯＡＤＡ', 256)).toBe('feijoada') // largura cheia
    expect(canonicalSearchQuery('ﬁlet', 256)).toBe('filet') // ligadura ﬁ
    expect(canonicalSearchQuery('a b', 256)).toBe('a b') // NBSP
  })

  it('acento fica (o embedder vê "pão" ≠ "pao")', () => {
    expect(canonicalSearchQuery('Pão', 256)).toBe('pão')
  })

  it('corta no teto DEPOIS de normalizar, sem espaço na ponta', () => {
    expect(canonicalSearchQuery('ab   cd', 3)).toBe('ab')
    expect(canonicalSearchQuery('x'.repeat(300), 256)).toHaveLength(256)
  })

  it('só espaço vira vazio', () => {
    expect(canonicalSearchQuery(' \n\t ', 256)).toBe('')
  })
})

describe('embeddableSearchQuery', () => {
  it('pelo menos 3 caracteres (code points) e uma letra ou dígito', () => {
    for (const q of ['pão', 'abc', '42 receitas', 'ﬁgo']) expect(embeddableSearchQuery(canonicalSearchQuery(q, 256))).toBe(true)
    for (const q of ['', 'a', 'pã', '!!!', '— . —', '...', '🍕🍕🍕']) {
      expect(embeddableSearchQuery(canonicalSearchQuery(q, 256))).toBe(false)
    }
  })
})
