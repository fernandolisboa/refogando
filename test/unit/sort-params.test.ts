import { describe, it, expect } from 'vitest'
import { parseSort } from '@/domain/sort-params'

/**
 * Parse de borda do ?sort= (issue #16, AC3). PERMISSIVO: só 'popularidade' resolve;
 * tudo o mais (null, vazio, lixo, variações de caixa) degrada para 'relevancia'. NUNCA 400.
 */

describe('parseSort — borda permissiva', () => {
  it("'popularidade' ⇒ 'popularidade'", () => {
    expect(parseSort('popularidade')).toBe('popularidade')
  })

  it("'relevancia' ⇒ 'relevancia'", () => {
    expect(parseSort('relevancia')).toBe('relevancia')
  })

  it('null (ausente) ⇒ relevancia (default)', () => {
    expect(parseSort(null)).toBe('relevancia')
  })

  it.each(['', 'POPULARIDADE', 'popular', 'lixo', 'rank', ' popularidade '])(
    "valor inesperado %j ⇒ 'relevancia' (degrada, nunca 400)",
    (raw) => {
      expect(parseSort(raw)).toBe('relevancia')
    },
  )
})
