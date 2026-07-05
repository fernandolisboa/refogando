import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealRecipeImporter } from '@/server/import/recipe-importer'
import { createDomainRateLimiter, type DomainRateLimiter } from '@/server/import/rate-limit'
import type { AddressLookup } from '@/server/import/web-fetch'

/** DNS injetado: o importer agora resolve o host ANTES de conectar (#448) — fixa um IP público (não toca a rede). */
const publicLookup: AddressLookup = async () => ['203.0.113.10']

/**
 * Guard-rails do seam REAL (#272, ADR-0019) — caminho de REDE com `fetch` mockado (espelha
 * `web-search-provider.test.ts`). Os módulos PUROS (`isPathAllowedByRobots`, `createDomainRateLimiter`)
 * são cobertos em `test/domain/robots-txt.test.ts` e `test/unit/import-rate-limit.test.ts`; AQUI
 * provamos a FIAÇÃO dos hooks que os units puros não alcançam:
 *  - robots: `checkRobotsAllowed` roda antes do fetch e curto-circuita no `Disallow`; FAIL-OPEN
 *    (404/5xx/timeout/erro/redirect ⇒ permitido);
 *  - rate-limit: a janela por domínio gateia ANTES de qualquer rede (limitada ⇒ zero fetch).
 * O `FakeRecipeImporter` ignora a URL e pula ambos (os route tests de #165 ficam intactos).
 */

/** Limiter permissivo p/ isolar os testes de robots (senão imports do mesmo host em sequência são limitados). */
const ALLOW_ALL: DomainRateLimiter = { tryAcquire: () => true }

const URL_ALVO = 'https://exemplo.com/receitas/bolo' // path = /receitas/bolo
const ROBOTS_URL = 'https://exemplo.com/robots.txt'

const PAGE_HTML = `<html lang="pt-BR"><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Bolo de Cenoura',
  recipeIngredient: ['2 ovos'],
  recipeInstructions: ['Misture tudo.'],
})}</script></head><body></body></html>`

type RobotsReply =
  | { ok: boolean; status?: number; body?: string; contentLength?: number }
  | { throw: true }
  | { redirect: true }

/** Mocka o `fetch` global roteando por URL: o `/robots.txt` segue `robots`; a página devolve JSON-LD válido. */
function mockFetch(robots: RobotsReply) {
  const calls: string[] = []
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/robots.txt')) {
      if ('throw' in robots) throw new TypeError('robots network down')
      // redirect:'manual' faz o fetch real devolver uma resposta opaca não-ok (status 0) p/ um 3xx.
      if ('redirect' in robots) return { ok: false, status: 0, headers: new Headers(), text: async () => '' } as Response
      const headers = new Headers()
      if (robots.contentLength != null) headers.set('content-length', String(robots.contentLength))
      return {
        ok: robots.ok,
        status: robots.status ?? (robots.ok ? 200 : 404),
        headers,
        text: async () => robots.body ?? '',
      } as Response
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => PAGE_HTML } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

const importer = new RealRecipeImporter(ALLOW_ALL, publicLookup)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RealRecipeImporter — guard-rail robots.txt (#272)', () => {
  it('robots.txt PROÍBE o path → robots_blocked e a página NÃO é buscada', async () => {
    const { calls } = mockFetch({ ok: true, body: 'User-agent: *\nDisallow: /receitas' })
    const res = await importer.import(URL_ALVO)
    expect(res).toEqual({ ok: false, reason: 'robots_blocked' })
    expect(calls).toContain(ROBOTS_URL)
    expect(calls).not.toContain(URL_ALVO) // curto-circuito: sem fetch da página
  })

  it('robots.txt 404 (site sem arquivo) → fail-open: a página É buscada e importa', async () => {
    const { calls } = mockFetch({ ok: false, status: 404 })
    const res = await importer.import(URL_ALVO)
    expect(res.ok).toBe(true)
    expect(calls).toContain(URL_ALVO)
  })

  it('robots.txt 5xx → fail-open: a página É buscada', async () => {
    const { calls } = mockFetch({ ok: false, status: 503 })
    const res = await importer.import(URL_ALVO)
    expect(res.ok).toBe(true)
    expect(calls).toContain(URL_ALVO)
  })

  it('robots.txt lança (rede caiu) → fail-open: a página É buscada', async () => {
    const { calls } = mockFetch({ throw: true })
    const res = await importer.import(URL_ALVO)
    expect(res.ok).toBe(true)
    expect(calls).toContain(URL_ALVO)
  })

  it('robots.txt redireciona (manual ⇒ não-ok) → fail-open, NÃO persegue: busca a página', async () => {
    const { calls } = mockFetch({ redirect: true })
    const res = await importer.import(URL_ALVO)
    expect(res.ok).toBe(true)
    expect(calls).toContain(URL_ALVO)
  })

  it('robots.txt PERMITE explicitamente o path → a página é buscada', async () => {
    const { calls } = mockFetch({ ok: true, body: 'User-agent: *\nAllow: /receitas\nDisallow: /outro' })
    const res = await importer.import(URL_ALVO)
    expect(res.ok).toBe(true)
    expect(calls).toContain(URL_ALVO)
  })

  it('robots.txt com Content-Length absurdo → fail-open: não bufferiza, busca a página', async () => {
    const { calls } = mockFetch({ ok: true, contentLength: 50 * 1024 * 1024, body: 'User-agent: *\nDisallow: /receitas' })
    const res = await importer.import(URL_ALVO)
    expect(res.ok).toBe(true) // tamanho declarado > cap ⇒ tratado como indisponível (permitido)
    expect(calls).toContain(URL_ALVO)
  })
})

describe('RealRecipeImporter — guard-rail rate-limit (#272)', () => {
  function fixedClock(start = 0) {
    let t = start
    return { now: () => t, advance: (ms: number) => (t += ms) }
  }

  it('2ª importação do mesmo domínio dentro da janela → rate_limited e ZERO rede (gateia antes do robots)', async () => {
    const clock = fixedClock()
    const limited = new RealRecipeImporter(createDomainRateLimiter({ now: clock.now }), publicLookup)
    const { calls } = mockFetch({ ok: false, status: 404 }) // robots 404 ⇒ permite a 1ª importação

    expect((await limited.import(URL_ALVO)).ok).toBe(true)
    const afterFirst = calls.length // robots.txt + página

    clock.advance(500) // ainda dentro da janela de 1s
    const second = await limited.import(URL_ALVO)
    expect(second).toEqual({ ok: false, reason: 'rate_limited' })
    expect(calls.length).toBe(afterFirst) // nenhum fetch novo — nem robots.txt nem página
  })

  it('passada a janela (>= 1s), o mesmo domínio importa de novo', async () => {
    const clock = fixedClock()
    const limited = new RealRecipeImporter(createDomainRateLimiter({ now: clock.now }), publicLookup)
    mockFetch({ ok: false, status: 404 })

    expect((await limited.import(URL_ALVO)).ok).toBe(true)
    clock.advance(1000)
    expect((await limited.import(URL_ALVO)).ok).toBe(true)
  })
})
