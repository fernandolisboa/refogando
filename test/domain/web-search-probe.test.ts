import { describe, it, expect } from 'vitest'
import { jsonLdSignal, isImportable, type ProbeReport } from '@/domain/web-search-probe'
import { parseImportedRecipe } from '@/domain/recipe-import-parse'

/**
 * Derivação PURA do probe (#273): `jsonLdSignal` sobre o `ParseResult` real (3 estados) e a truth-table
 * de `isImportable`. Reusa o parser real de JSON-LD (`recipe-import-parse.ts`) como fixture — o mesmo que
 * o seam REAL chama. Sem rede, sem DB.
 */

function htmlWith(jsonLd: unknown, opts?: { lang?: string }): string {
  const langAttr = opts?.lang ? ` lang="${opts.lang}"` : ''
  return `<!doctype html><html${langAttr}><head><script type="application/ld+json">${JSON.stringify(
    jsonLd,
  )}</script></head><body></body></html>`
}

const SRC = 'https://exemplo.com/receitas/bolo'

describe('jsonLdSignal (sobre parseImportedRecipe real)', () => {
  it('Recipe JSON-LD utilizável (PT/EN) → present', () => {
    const parse = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', name: 'Bolo', inLanguage: 'pt-BR', recipeInstructions: 'x' }),
      SRC,
    )
    expect(jsonLdSignal(parse)).toBe('present')
  })

  it('Recipe JSON-LD em idioma fora de PT/EN (fr) → present_unsupported_locale', () => {
    const parse = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', name: 'Ratatouille', inLanguage: 'fr-FR' }),
      SRC,
    )
    expect(parse).toEqual({ ok: false, reason: 'unsupported_locale' })
    expect(jsonLdSignal(parse)).toBe('present_unsupported_locale')
  })

  it('sem Recipe JSON-LD → absent', () => {
    const parse = parseImportedRecipe(htmlWith({ '@type': 'Article', headline: 'x' }), SRC)
    expect(jsonLdSignal(parse)).toBe('absent')
  })

  it('JSON-LD presente mas sem name de Recipe → absent (no_jsonld)', () => {
    const parse = parseImportedRecipe(
      htmlWith({ '@type': 'Recipe', inLanguage: 'pt-BR', recipeInstructions: 'x' }),
      SRC,
    )
    expect(jsonLdSignal(parse)).toBe('absent')
  })
})

describe('isImportable (truth-table)', () => {
  const base: ProbeReport = { fetched: true, jsonLd: 'present', robotsAllowed: true }

  it('só fetched && present && robotsAllowed ⇒ true', () => {
    expect(isImportable(base)).toBe(true)
  })

  it('fetched:false ⇒ false', () => {
    expect(isImportable({ ...base, fetched: false })).toBe(false)
  })

  it('robots bloqueia ⇒ false', () => {
    expect(isImportable({ ...base, robotsAllowed: false })).toBe(false)
  })

  it('JSON-LD ausente ⇒ false', () => {
    expect(isImportable({ ...base, jsonLd: 'absent' })).toBe(false)
  })

  it('JSON-LD presente mas idioma não suportado ⇒ false', () => {
    expect(isImportable({ ...base, jsonLd: 'present_unsupported_locale' })).toBe(false)
  })
})
