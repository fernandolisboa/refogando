import { describe, it, expect } from 'vitest'
import {
  isRefinedHomeParams,
  buildHomeMetadata,
  homeHreflangAlternates,
  type HomeMetadataInput,
} from '@/domain/discovery-home'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@/i18n/locale'

/**
 * Núcleo PURO da Descoberta-home (#236, ADR-0020) — sem DB, sem React, sem `next/*`. "A Descoberta é a
 * home": `/{locale}` é um feed indexável em REPOUSO; a Busca refina INLINE. O repouso indexa; qualquer
 * estado REFINADO (busca/filtro) é `noindex`.
 *
 * Decisões travadas exercitadas aqui:
 *  - `isRefinedHomeParams`: presença de qualquer `q`/faceta/`sort` ⇒ refinado; ausência (ou só vazio) ⇒
 *    repouso (estado indexável).
 *  - `buildHomeMetadata`: repouso ⇒ index/follow + canonical `/{locale}` + hreflang + `x-default → /`;
 *    refinado ⇒ noindex/nofollow SEM canonical de conteúdo.
 */

const BASE = 'https://refogando.com'

function input(over: Partial<HomeMetadataInput> = {}): HomeMetadataInput {
  return {
    locale: 'pt-BR',
    baseUrl: BASE,
    title: 'Descubra receitas',
    description: 'Navegue o acervo da comunidade.',
    brandName: 'Refogando',
    refined: false,
    ...over,
  }
}

describe('isRefinedHomeParams — repouso (indexável) vs refinado (noindex)', () => {
  it('sem params ⇒ repouso (false)', () => {
    expect(isRefinedHomeParams(undefined)).toBe(false)
    expect(isRefinedHomeParams({})).toBe(false)
  })

  it('param de busca/filtro presente e não-vazio ⇒ refinado (true)', () => {
    expect(isRefinedHomeParams({ q: 'bolo' })).toBe(true)
    expect(isRefinedHomeParams({ cozinha: 'italiana' })).toBe(true)
    expect(isRefinedHomeParams({ categoria: 'sobremesa' })).toBe(true)
    expect(isRefinedHomeParams({ restricao: 'vegano' })).toBe(true)
    expect(isRefinedHomeParams({ sort: 'popularidade' })).toBe(true)
  })

  it('GUARDIÃO-DE-DRIFT: `match` (modo any/all do /api/search, #9) conta como refino ⇒ noindex', () => {
    // `match` ainda não é refletido na URL pela home, mas o /api/search o aceita. Se algum dia
    // for refletido, esse estado refinado tem de cair em noindex automaticamente — este teste trava
    // `match` dentro de REFINEMENT_PARAM_KEYS pra o gate de índice nunca ficar atrás do que a Busca aceita.
    expect(isRefinedHomeParams({ match: 'all' })).toBe(true)
    expect(isRefinedHomeParams({ match: 'any' })).toBe(true)
    // Vazio segue sendo repouso (mesma regra dos outros params).
    expect(isRefinedHomeParams({ match: '' })).toBe(false)
  })

  it('param presente porém VAZIO (?q=) NÃO conta como refino (repouso)', () => {
    expect(isRefinedHomeParams({ q: '' })).toBe(false)
    expect(isRefinedHomeParams({ q: '   ' })).toBe(false)
    // CONTROLE não-vácuo: um valor de verdade na MESMA chave já refina.
    expect(isRefinedHomeParams({ q: 'x' })).toBe(true)
  })

  it('multivalor (array) conta quando há ao menos um item não-vazio', () => {
    expect(isRefinedHomeParams({ cozinha: ['italiana', 'japonesa'] })).toBe(true)
    expect(isRefinedHomeParams({ cozinha: ['', ''] })).toBe(false)
  })

  it('parâmetros NÃO-refino (ex.: utm) são ignorados ⇒ repouso', () => {
    expect(isRefinedHomeParams({ utm_source: 'newsletter', ref: 'x' })).toBe(false)
  })
})

describe('buildHomeMetadata — repouso indexável', () => {
  it('repouso ⇒ robots index/follow + canonical /{locale} + hreflang + x-default → raiz /', () => {
    const meta = buildHomeMetadata(input({ locale: 'pt-BR', refined: false }))
    const robots = meta.robots as { index?: boolean; follow?: boolean }
    expect(robots.index).toBe(true)
    expect(robots.follow).toBe(true)
    expect(meta.alternates?.canonical).toBe(`${BASE}/pt-BR`)
    const langs = meta.alternates?.languages as Record<string, string>
    expect(langs['pt-BR']).toBe(`${BASE}/pt-BR`)
    expect(langs['en-US']).toBe(`${BASE}/en-US`)
    expect(langs['x-default']).toBe(`${BASE}/`)
    // OG de marca (website), sem conteúdo de receita.
    expect(meta.openGraph?.url).toBe(`${BASE}/pt-BR`)
  })

  it('canonical segue o locale corrente (en-US)', () => {
    const meta = buildHomeMetadata(input({ locale: 'en-US', refined: false }))
    expect(meta.alternates?.canonical).toBe(`${BASE}/en-US`)
  })
})

describe('buildHomeMetadata — estado refinado (noindex)', () => {
  it('refinado ⇒ robots noindex/nofollow e SEM canonical/hreflang de conteúdo', () => {
    const meta = buildHomeMetadata(input({ refined: true }))
    const robots = meta.robots as { index?: boolean; follow?: boolean }
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    expect(meta.alternates?.canonical).toBeUndefined()
    expect(meta.alternates?.languages).toBeUndefined()
  })
})

describe('homeHreflangAlternates — fonte única (espelha buildStaticLocaleEntries)', () => {
  it('lista TODAS as homes por locale + x-default → raiz /', () => {
    const langs = homeHreflangAlternates(BASE)
    for (const loc of SUPPORTED_LOCALES) expect(langs[loc]).toBe(`${BASE}/${loc}`)
    expect(langs['x-default']).toBe(`${BASE}/`)
    // x-default da home é a RAIZ (≠ detalhe, que aponta pro DEFAULT_LOCALE).
    expect(langs['x-default']).not.toBe(`${BASE}/${DEFAULT_LOCALE}`)
  })
})
