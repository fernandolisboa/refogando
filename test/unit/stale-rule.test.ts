import { describe, expect, it } from 'vitest'
import {
  INVARIANT_FIELDS,
  TRANSLATABLE_FIELDS,
  decideStale,
  isTranslatableField,
} from '@/domain/stale-rule'

describe('Regra de stale — flag-flip puro (AC#8)', () => {
  it('isTranslatableField: só os campos por-locale', () => {
    for (const f of TRANSLATABLE_FIELDS) expect(isTranslatableField(f)).toBe(true)
    for (const f of INVARIANT_FIELDS) expect(isTranslatableField(f)).toBe(false)
    expect(isTranslatableField('inexistente')).toBe(false)
  })

  it('mudança em campo traduzível ⇒ locale entra em tradução E embedding', () => {
    expect(decideStale({ changedFields: ['titulo'], locale: 'pt-BR' })).toEqual({
      staleTranslations: ['pt-BR'],
      staleEmbeddings: ['pt-BR'],
    })
  })

  it('mudança só em campo invariante ⇒ ambas as listas vazias', () => {
    expect(decideStale({ changedFields: ['quantidade'], locale: 'pt-BR' })).toEqual({
      staleTranslations: [],
      staleEmbeddings: [],
    })
  })

  it('qualquer campo traduzível na lista basta para obsoletar o locale', () => {
    expect(decideStale({ changedFields: ['quantidade', 'passos'], locale: 'en-US' })).toEqual({
      staleTranslations: ['en-US'],
      staleEmbeddings: ['en-US'],
    })
  })

  it('nenhum campo alterado ⇒ ambas vazias', () => {
    expect(decideStale({ changedFields: [], locale: 'pt-BR' })).toEqual({
      staleTranslations: [],
      staleEmbeddings: [],
    })
  })
})
