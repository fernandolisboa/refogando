import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealRecipeProbe, type AddressLookup } from '@/server/import/recipe-probe'
import { MAX_HTML_BYTES } from '@/server/import/web-fetch'

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
  it('robots PROÍBE o path → robotsAllowed:false e a página NÃO é buscada (espelha o importer)', async () => {
    const { calls } = mockFetch({ robots: { ok: true, body: 'User-agent: *\nDisallow: /receitas' } })
    const probe = new RealRecipeProbe(publicLookup)
    const report = await probe.probe(URL_ALVO)
    expect(report).toEqual({ fetched: false, jsonLd: 'absent', robotsAllowed: false })
    expect(calls).toContain(ROBOTS_URL)
    expect(calls).not.toContain(URL_ALVO) // guard-rail: robots proíbe ⇒ NÃO martelamos a página
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

/**
 * Cobre o caminho de STREAMING (`res.body` = ReadableStream REAL) que o `mockFetch` acima — que só expõe
 * `text()` — não alcança: leitura sob o cap, OVERFLOW do cap (trunca+parseia, espelha o importer), e um hop
 * de redirect p/ host público seguido e parseado pelo stream.
 */
describe('RealRecipeProbe — leitura por streaming (body = ReadableStream real)', () => {
  /** Response REAL com body = ReadableStream, emitido em pedaços p/ exercitar o loop de leitura. */
  function streamingResponse(
    bytes: Uint8Array,
    opts?: { status?: number; headers?: Record<string, string> },
  ): Response {
    const CHUNK = 64 * 1024
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += CHUNK) {
          controller.enqueue(bytes.slice(i, i + CHUNK)) // slice = cópia (sem aliasar o buffer de origem)
        }
        controller.close()
      },
    })
    return new Response(stream, { status: opts?.status ?? 200, headers: opts?.headers })
  }

  it('(a) corpo SOB o cap → JSON-LD lido do stream e parseado', async () => {
    const bytes = new TextEncoder().encode(PAGE_HTML)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
        return streamingResponse(bytes)
      }),
    )
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report).toEqual({ fetched: true, jsonLd: 'present', robotsAllowed: true })
  })

  it('(b) corpo ACIMA do cap → trunca em MAX_HTML_BYTES e PARSEIA o prefixo (não vira null — espelha o importer)', async () => {
    // JSON-LD válido no <head> (dentro do cap); depois lixo empurrando o total ALÉM de MAX_HTML_BYTES.
    const head = new TextEncoder().encode(PAGE_HTML)
    const oversized = new Uint8Array(MAX_HTML_BYTES + 50_000)
    oversized.set(head, 0)
    oversized.fill(0x20, head.length) // resto = espaços (HTML inerte) só p/ estourar o cap
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
        return streamingResponse(oversized) // sem content-length: o overflow só aparece no stream
      }),
    )
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    // Antes do fix, overflow virava fetched:false; agora o prefixo (com o <head>) é parseado.
    expect(report).toEqual({ fetched: true, jsonLd: 'present', robotsAllowed: true })
  })

  it('(c) redirect 301 p/ host PÚBLICO é seguido e a página final (streaming) é parseada', async () => {
    const FINAL = 'https://destino.com/receita-final'
    const impl = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
      if (url === URL_ALVO) return new Response(null, { status: 301, headers: { location: FINAL } })
      return streamingResponse(new TextEncoder().encode(PAGE_HTML))
    })
    vi.stubGlobal('fetch', impl)
    const report = await new RealRecipeProbe(publicLookup).probe(URL_ALVO)
    expect(report).toEqual({ fetched: true, jsonLd: 'present', robotsAllowed: true })
    expect(impl.mock.calls.map((c) => String(c[0]))).toContain(FINAL) // hop seguido
  })
})
