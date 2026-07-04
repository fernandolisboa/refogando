import { describe, it, expect } from 'vitest'
import {
  buildSitemapEntries,
  buildStaticLocaleEntries,
  type SitemapRecipe,
} from '@/domain/sitemap'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE } from '@/i18n/locale'

/**
 * Builder PURO do sitemap (#235, ADR-0020) — sem DB, sem `next/*` além do tipo `MetadataRoute`.
 * Recebe as Receitas elegíveis (já gateadas pela query) com seus slugs POR locale + um
 * `lastModified`, mais a `baseUrl` build-safe (env, sem `headers()`), e devolve as entradas do
 * `MetadataRoute.Sitemap`: UMA por (receita, locale com slug), URL ABSOLUTA via `recipeDetailPath`,
 * e `alternates.languages` (hreflang) ligando os locales existentes + `x-default` → DEFAULT_LOCALE.
 * Espelha a mesma lógica de `recipeHreflangAlternates`/`recipeDetailPath` do detalhe (#233).
 */

const BASE = 'https://refogando.com'

/** Fixture-base de uma Receita bilíngue (slug nos dois locales) com lastModified fixo. */
function recipe(over: Partial<SitemapRecipe> = {}): SitemapRecipe {
  return {
    slugsByLocale: { 'pt-BR': 'bolo-de-cenoura', 'en-US': 'carrot-cake' },
    lastModified: new Date('2026-06-20T12:00:00.000Z'),
    ...over,
  }
}

describe('buildSitemapEntries — uma entrada por (receita, locale com slug)', () => {
  it('Receita bilíngue ⇒ duas entradas (pt-BR + en-US), URL absoluta canônica', () => {
    const entries = buildSitemapEntries([recipe()], BASE)
    const urls = entries.map((e) => e.url)
    expect(urls).toContain(`${BASE}/pt-BR/recipes/bolo-de-cenoura`)
    expect(urls).toContain(`${BASE}/en-US/recipes/carrot-cake`)
    expect(entries).toHaveLength(2)
  })

  it('Receita só-pt-BR ⇒ SÓ a entrada pt-BR (não inventa URL de locale inexistente)', () => {
    const entries = buildSitemapEntries([recipe({ slugsByLocale: { 'pt-BR': 'pao' } })], BASE)
    expect(entries).toHaveLength(1)
    expect(entries[0].url).toBe(`${BASE}/pt-BR/recipes/pao`)
  })

  it('propaga lastModified de cada Receita', () => {
    const when = new Date('2026-01-02T03:04:05.000Z')
    const entries = buildSitemapEntries(
      [recipe({ slugsByLocale: { 'pt-BR': 'x' }, lastModified: when })],
      BASE,
    )
    expect(entries[0].lastModified).toBe(when)
  })

  it('hreflang: cada entrada lista TODOS os locales com slug + x-default → DEFAULT_LOCALE', () => {
    const entries = buildSitemapEntries([recipe()], BASE)
    for (const e of entries) {
      const langs = e.alternates?.languages ?? {}
      expect(langs['pt-BR']).toBe(`${BASE}/pt-BR/recipes/bolo-de-cenoura`)
      expect(langs['en-US']).toBe(`${BASE}/en-US/recipes/carrot-cake`)
      expect(langs['x-default']).toBe(`${BASE}/${DEFAULT_LOCALE}/recipes/bolo-de-cenoura`)
    }
  })

  it('hreflang de Receita só-en-US: x-default degrada pro único locale presente', () => {
    const entries = buildSitemapEntries(
      [recipe({ slugsByLocale: { 'en-US': 'only-en' } })],
      BASE,
    )
    expect(entries).toHaveLength(1)
    const langs = entries[0].alternates?.languages ?? {}
    expect(langs['pt-BR']).toBeUndefined()
    expect(langs['en-US']).toBe(`${BASE}/en-US/recipes/only-en`)
    // DEFAULT_LOCALE (pt-BR) não tem slug ⇒ x-default cai no único presente (en-US).
    expect(langs['x-default']).toBe(`${BASE}/en-US/recipes/only-en`)
  })

  it('Receita sem slug em nenhum locale ⇒ ZERO entradas (defensivo)', () => {
    const entries = buildSitemapEntries([recipe({ slugsByLocale: {} })], BASE)
    expect(entries).toHaveLength(0)
  })

  it('várias Receitas ⇒ achatadas em todas as entradas', () => {
    const entries = buildSitemapEntries(
      [
        recipe({ slugsByLocale: { 'pt-BR': 'a' } }),
        recipe({ slugsByLocale: { 'pt-BR': 'b', 'en-US': 'b-en' } }),
      ],
      BASE,
    )
    expect(entries).toHaveLength(3)
  })
})

describe('buildStaticLocaleEntries — homes + páginas legais indexáveis por locale', () => {
  const homeUrls = SUPPORTED_LOCALES.map((loc) => `${BASE}/${loc}`)
  const homeEntries = (entries: ReturnType<typeof buildStaticLocaleEntries>) =>
    entries.filter((e) => homeUrls.includes(e.url))

  it('uma entrada de home por locale suportado, URL absoluta da home', () => {
    const entries = buildStaticLocaleEntries(BASE)
    const urls = entries.map((e) => e.url)
    for (const loc of SUPPORTED_LOCALES) {
      expect(urls).toContain(`${BASE}/${loc}`)
    }
    expect(homeEntries(entries)).toHaveLength(SUPPORTED_LOCALES.length)
  })

  it('cada home lista as outras homes no hreflang + x-default → raiz `/` redirecionadora', () => {
    for (const e of homeEntries(buildStaticLocaleEntries(BASE))) {
      const langs = e.alternates?.languages ?? {}
      for (const loc of SUPPORTED_LOCALES) {
        expect(langs[loc]).toBe(`${BASE}/${loc}`)
      }
      // ADR-0020 dec.5: a home aponta x-default pra raiz `/` (negocia idioma), não pra um locale.
      expect(langs['x-default']).toBe(`${BASE}/`)
    }
  })

  // Páginas legais publicadas (parte de #276): Política de Privacidade + Seus Direitos.
  for (const path of ['privacidade', 'seus-direitos'] as const) {
    it(`inclui /${path} por locale, com hreflang + x-default → DEFAULT_LOCALE`, () => {
      const entries = buildStaticLocaleEntries(BASE)
      const urls = entries.map((e) => e.url)
      for (const loc of SUPPORTED_LOCALES) {
        expect(urls).toContain(`${BASE}/${loc}/${path}`)
      }
      const pageEntries = entries.filter((e) => e.url.endsWith(`/${path}`))
      expect(pageEntries).toHaveLength(SUPPORTED_LOCALES.length)
      for (const e of pageEntries) {
        const langs = e.alternates?.languages ?? {}
        for (const loc of SUPPORTED_LOCALES) {
          expect(langs[loc]).toBe(`${BASE}/${loc}/${path}`)
        }
        // Sem redirecionador por-página na raiz: x-default aponta pra versão no DEFAULT_LOCALE.
        expect(langs['x-default']).toBe(`${BASE}/${DEFAULT_LOCALE}/${path}`)
      }
    })
  }
})
