import { describe, expect, it } from 'vitest'
import { parseProCaps, type ProCaps } from '@/domain/pro-caps'

/**
 * Tabela `pro` dos tetos de cota (Fase 2, #466) — PURO. `parseProCaps` valida o bundle
 * `{ recipeGen, imageGen, extraction }` (tudo-ou-nada): os TRÊS eixos válidos ⇒ o bundle; qualquer
 * eixo ausente/inválido ⇒ `null` (sem tabela pro pela metade). Reusa os validadores por-eixo.
 */

const valid: ProCaps = {
  recipeGen: { usuario: 100, curador: 200, admin: null },
  imageGen: { usuario: 30, curador: 50, admin: null },
  extraction: { usuario: 600, curador: 1200, admin: null },
}

describe('parseProCaps — bundle da tabela pro', () => {
  it('bundle completo e válido ⇒ o bundle (round-trip exato)', () => {
    expect(parseProCaps(valid)).toEqual(valid)
  })

  it('não-objeto (null, array, primitivo) ⇒ null', () => {
    expect(parseProCaps(null)).toBeNull()
    expect(parseProCaps(undefined)).toBeNull()
    expect(parseProCaps([])).toBeNull()
    expect(parseProCaps('x')).toBeNull()
    expect(parseProCaps(42)).toBeNull()
  })

  it('tudo-ou-nada: QUALQUER eixo ausente ⇒ null', () => {
    expect(parseProCaps({ imageGen: valid.imageGen, extraction: valid.extraction })).toBeNull()
    expect(parseProCaps({ recipeGen: valid.recipeGen, extraction: valid.extraction })).toBeNull()
    expect(parseProCaps({ recipeGen: valid.recipeGen, imageGen: valid.imageGen })).toBeNull()
  })

  it('tudo-ou-nada: QUALQUER eixo inválido (papel faltando, float, negativo, chave estranha) ⇒ null', () => {
    expect(parseProCaps({ ...valid, recipeGen: { usuario: 1, curador: 2 } })).toBeNull() // falta admin
    expect(parseProCaps({ ...valid, imageGen: { usuario: 1.5, curador: 2, admin: null } })).toBeNull()
    expect(parseProCaps({ ...valid, extraction: { usuario: -1, curador: 2, admin: null } })).toBeNull()
    expect(
      parseProCaps({ ...valid, recipeGen: { usuario: 1, curador: 2, admin: null, root: 9 } }),
    ).toBeNull() // chave estranha
  })

  it('null (∞) e 0 (papel zerado) são valores VÁLIDOS de teto em cada eixo', () => {
    const edge: ProCaps = {
      recipeGen: { usuario: 0, curador: 0, admin: null },
      imageGen: { usuario: 0, curador: 0, admin: null },
      extraction: { usuario: 0, curador: 0, admin: null },
    }
    expect(parseProCaps(edge)).toEqual(edge)
  })
})
