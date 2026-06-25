import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealRecipeImporter } from '@/server/import/recipe-importer'

/**
 * Guard-rail robots.txt do seam REAL (#272, ADR-0019) — caminho de REDE com `fetch` mockado (espelha
 * `web-search-provider.test.ts`). O matcher PURO (`isPathAllowedByRobots`) é coberto em
 * `test/domain/robots-txt.test.ts`; AQUI provamos a fiação do hook que o unit puro NÃO alcança:
 *  - `checkRobotsAllowed` roda ANTES do fetch da página e curto-circuita quando o robots.txt proíbe;
 *  - é FAIL-OPEN deliberado — 404/5xx/timeout/erro-de-rede/redirect ⇒ permitido (busca a página).
 * O `FakeRecipeImporter` ignora a URL e pula esse hook (os route tests de #165 ficam intactos).
 */

const URL_ALVO = 'https://exemplo.com/receitas/bolo' // path = /receitas/bolo
const ROBOTS_URL = 'https://exemplo.com/robots.txt'

const PAGE_HTML = `<html lang="pt-BR"><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Bolo de Cenoura',
  recipeIngredient: ['2 ovos'],
  recipeInstructions: ['Misture tudo.'],
})}</script></head><body></body></html>`

type RobotsReply = { ok: boolean; status?: number; body?: string } | { throw: true } | { redirect: true }

/** Mocka o `fetch` global roteando por URL: o `/robots.txt` segue `robots`; a página devolve JSON-LD válido. */
function mockFetch(robots: RobotsReply) {
  const calls: string[] = []
  const impl = vi.fn(async (input: unknown) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/robots.txt')) {
      if ('throw' in robots) throw new TypeError('robots network down')
      // redirect:'manual' faz o fetch real devolver uma resposta opaca não-ok (status 0) p/ um 3xx.
      if ('redirect' in robots) return { ok: false, status: 0, text: async () => '' } as Response
      return {
        ok: robots.ok,
        status: robots.status ?? (robots.ok ? 200 : 404),
        text: async () => robots.body ?? '',
      } as Response
    }
    return { ok: true, status: 200, text: async () => PAGE_HTML } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

const importer = new RealRecipeImporter()

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
})
