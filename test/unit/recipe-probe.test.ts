import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealRecipeProbe, type AddressLookup } from '@/server/import/recipe-probe'

/**
 * Seam REAL do probe (#273) — caminho de REDE com `fetch` mockado e `lookup` injetado (espelha
 * `recipe-importer-robots.test.ts`). Os módulos PUROS (parseProbeUrl/isBlockedAddress, jsonLdSignal/
 * isImportable) são cobertos em test/unit/probe-url.test.ts e test/domain/web-search-probe.test.ts; AQUI
 * provamos a FIAÇÃO que os units não alcançam: robots independente da página, fail-open do robots, a
 * defesa de DNS-rebind, e a re-validação por hop de redirect.
 */

const URL_ALVO = 'https://exemplo.com/receitas/bolo'
const ROBOTS_URL = 'https://exemplo.com/robots.txt'

const PAGE_HTML = `<html lang="pt-BR"><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Bolo de Cenoura',
  recipeIngredient: ['2 ovos'],
  recipeInstructions: ['Misture tudo.'],
})}</script></head><body></body></html>`

const PAGE_HTML_NO_RECIPE = `<html lang="pt-BR"><head><script type="application/ld+json">${JSON.stringify(
  { '@context': 'https://schema.org', '@type': 'Article', headline: 'Não é receita' },
)}</script></head><body></body></html>`

type RobotsReply =
  | { ok: boolean; status?: number; body?: string }
  | { throw: true }
  | { redirect: true }
type PageReply =
  | { ok?: boolean; status?: number; html?: string; location?: string }
  | { throw: true }

/** Mocka o `fetch` global roteando por URL: o `/robots.txt` segue `robots`; o resto segue `page`. */
function mockFetch(opts: { robots?: RobotsReply; page?: PageReply }) {
  const calls: string[] = []
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/robots.txt')) {
      const r: RobotsReply = opts.robots ?? { ok: false, status: 404 }
      if ('throw' in r) throw new TypeError('robots down')
      if ('redirect' in r) return { ok: false, status: 0, headers: new Headers(), text: async () => '' } as Response
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 404),
        headers: new Headers(),
        text: async () => r.body ?? '',
      } as Response
    }
    const p: PageReply = opts.page ?? { ok: true, html: PAGE_HTML }
    if ('throw' in p) throw new TypeError('page down')
    const headers = new Headers()
    if (p.location) headers.set('location', p.location)
    return {
      ok: p.ok ?? true,
      status: p.status ?? 200,
      headers,
      text: async () => p.html ?? PAGE_HTML,
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

const publicLookup: AddressLookup = async () => ['203.0.113.10']
const privateLookup: AddressLookup = async () => ['10.0.0.5']

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealRecipeProbe — sinais independentes (JSON-LD + robots)', () => {
  it('robots PROÍBE o path → robotsAllowed:false, MAS a página ainda é buscada e o JSON-LD reportado', async () => {
    const { calls } = mockFetch({ robots: { ok: true, body: 'User-agent: *\nDisallow: /receitas' } })
    const probe = new RealRecipeProbe(publicLookup)
    const report = await probe.probe(URL_ALVO)
    expect(report).toEqual({ fetched: true, jsonLd: 'present', robotsAllowed: false })
    expect(calls).toContain(ROBOTS_URL)
    expect(calls).toContain(URL_ALVO) // divergência-chave do importer: a página NÃO é curto-circuitada
  })

  it('robots PERMITE + página com Recipe → tudo verde', async () => {
    mockFetch({ robots: { ok: true, body: 'User-agent: *\nAllow: /' }, page: { html: PAGE_HTML } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report).toEqual({ fetched: true, jsonLd: 'present', robotsAllowed: true })
  })

  it('robots 404 → fail-open (robotsAllowed:true)', async () => {
    mockFetch({ robots: { ok: false, status: 404 } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.robotsAllowed).toBe(true)
  })

  it('robots lança → fail-open (robotsAllowed:true)', async () => {
    mockFetch({ robots: { throw: true } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.robotsAllowed).toBe(true)
  })

  it('robots redireciona (manual ⇒ opaco) → fail-open (robotsAllowed:true)', async () => {
    mockFetch({ robots: { redirect: true } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.robotsAllowed).toBe(true)
  })

  it('página com JSON-LD mas sem Recipe → jsonLd:absent (mas fetched:true)', async () => {
    mockFetch({ page: { html: PAGE_HTML_NO_RECIPE } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.fetched).toBe(true)
    expect(report.jsonLd).toBe('absent')
  })
})

describe('RealRecipeProbe — página não carrega', () => {
  it('página non-2xx → fetched:false', async () => {
    mockFetch({ page: { ok: false, status: 500 } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.fetched).toBe(false)
    expect(report.jsonLd).toBe('absent')
  })

  it('página lança (rede caiu) → fetched:false', async () => {
    mockFetch({ page: { throw: true } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.fetched).toBe(false)
  })
})

describe('RealRecipeProbe — defesa de SSRF (DNS + redirect por hop)', () => {
  it('host resolve para IP PRIVADO → fetched:false e NENHUM fetch (nem robots, nem página)', async () => {
    const { calls } = mockFetch({ page: { html: PAGE_HTML } })
    const report = await new RealRecipeProbe(privateLookup).probe(URL_ALVO)
    expect(report.fetched).toBe(false)
    expect(calls).toEqual([]) // DNS-rebind fechado: nada toca a rede
  })

  it('redirect 301 para host PRIVADO (literal) → fetched:false (re-validação por hop)', async () => {
    mockFetch({ page: { status: 301, location: 'http://127.0.0.1/evil' } })
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report.fetched).toBe(false)
  })

  it('nunca lança: lookup que rejeita também vira fetched:false', async () => {
    mockFetch({ page: { html: PAGE_HTML } })
    const throwingLookup: AddressLookup = async () => {
      throw new Error('dns down')
    }
    const report = await new RealRecipeProbe(throwingLookup).probe(URL_ALVO)
    expect(report.fetched).toBe(false)
  })
})
