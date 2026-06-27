import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  RealWebSearchProvider,
  MAX_WEB_RESULTS,
  MAX_SITE_QUERIES,
} from '@/server/web-search/web-search-provider'

/**
 * Provedor REAL Brave (#271) — caminho de REDE, com `fetch` mockado (a `WEB_SEARCH_API_KEY` vem de
 * `vi.stubEnv`). Prova: fail-closed (sem chave/allowlist/termo, NÃO toca a rede), a query `site:` por
 * domínio (uma requisição por domínio — `site:` múltiplo seria ANDado), o header `X-Subscription-Token`,
 * o mapeamento `web.results` → `{title,url,sourceName}`, dedup+cap, a RE-FILTRAGEM pela allowlist
 * (defesa em profundidade) e que QUALQUER erro vira `[]` (NUNCA lança). O `FakeWebSearchProvider` cobre
 * o fluxo do endpoint em `discovery-web.test.ts`.
 */

const KEY = 'brave-test-key'
const provider = new RealWebSearchProvider()

type Reply = { ok: boolean; status?: number; body: unknown } | { throw: true }

function mockFetch(handler: (url: string, init: RequestInit | undefined) => Reply) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const r = handler(url, init)
    if ('throw' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function webBody(results: Array<Record<string, unknown>>) {
  return { ok: true as const, body: { web: { results } } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('RealWebSearchProvider (#271) — fail-closed (não toca a rede)', () => {
  it('sem WEB_SEARCH_API_KEY → [] e fetch não é chamado', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', '')
    const { impl } = mockFetch(() => webBody([]))
    expect(await provider.search('feijoada', { allowlist: ['a.com'] })).toEqual([])
    expect(impl).not.toHaveBeenCalled()
  })

  it('allowlist vazia → [] e fetch não é chamado', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    const { impl } = mockFetch(() => webBody([]))
    expect(await provider.search('feijoada', { allowlist: [] })).toEqual([])
    expect(impl).not.toHaveBeenCalled()
  })

  it('termo vazio/espaços → [] e fetch não é chamado', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    const { impl } = mockFetch(() => webBody([]))
    expect(await provider.search('   ', { allowlist: ['a.com'] })).toEqual([])
    expect(impl).not.toHaveBeenCalled()
  })
})

describe('RealWebSearchProvider (#271) — consulta Brave + mapeamento', () => {
  it('consulta com site:<domínio>, count, locale e header X-Subscription-Token; mapeia web.results', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    const { calls } = mockFetch(() =>
      webBody([{ title: 'Feijoada', url: 'https://www.tudogostoso.com.br/r/1', description: '…' }]),
    )
    const out = await provider.search('feijoada', {
      allowlist: ['tudogostoso.com.br'],
      locale: 'pt-BR',
    })
    // sourceName = host pelado (sem www).
    expect(out).toEqual([
      { title: 'Feijoada', url: 'https://www.tudogostoso.com.br/r/1', sourceName: 'tudogostoso.com.br' },
    ])
    expect(calls).toHaveLength(1)
    const u = new URL(calls[0].url)
    expect(`${u.origin}${u.pathname}`).toBe('https://api.search.brave.com/res/v1/web/search')
    expect(u.searchParams.get('q')).toBe('feijoada site:tudogostoso.com.br')
    expect(u.searchParams.get('count')).toBe(String(MAX_WEB_RESULTS))
    expect(u.searchParams.get('country')).toBe('BR')
    // search_lang é enum fechado do Brave: pt-BR ⇒ 'pt-br' ('pt' dá HTTP 422 → []).
    expect(u.searchParams.get('search_lang')).toBe('pt-br')
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers['x-subscription-token']).toBe(KEY)
  })

  it('prefere o publisher do Brave (profile.name) como sourceName; cai no host se ausente', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    mockFetch(() =>
      webBody([
        { title: 'Com publisher', url: 'https://a.com/1', profile: { name: 'TudoGostoso' } },
        { title: 'Sem publisher', url: 'https://a.com/2' },
      ]),
    )
    const out = await provider.search('x', { allowlist: ['a.com'] })
    expect(out).toEqual([
      { title: 'Com publisher', url: 'https://a.com/1', sourceName: 'TudoGostoso' },
      { title: 'Sem publisher', url: 'https://a.com/2', sourceName: 'a.com' },
    ])
  })

  it('sem locale → não envia country/search_lang; en-US → US/en', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    const { calls } = mockFetch(() => webBody([]))
    await provider.search('x', { allowlist: ['a.com'] }) // sem locale
    const u1 = new URL(calls[0].url)
    expect(u1.searchParams.has('country')).toBe(false)
    expect(u1.searchParams.has('search_lang')).toBe(false)

    await provider.search('x', { allowlist: ['a.com'], locale: 'en-US' })
    const u2 = new URL(calls[1].url)
    expect(u2.searchParams.get('country')).toBe('US')
    expect(u2.searchParams.get('search_lang')).toBe('en')
  })

  it('uma requisição POR domínio da allowlist (site: múltiplo seria ANDado)', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    const { calls } = mockFetch((url) => {
      const q = new URL(url).searchParams.get('q') ?? ''
      if (q.includes('site:a.com')) return webBody([{ title: 'A', url: 'https://a.com/1' }])
      if (q.includes('site:b.com')) return webBody([{ title: 'B', url: 'https://b.com/1' }])
      return webBody([])
    })
    const out = await provider.search('x', { allowlist: ['a.com', 'b.com'] })
    expect(calls).toHaveLength(2)
    expect(out.map((r) => r.url).sort()).toEqual(['https://a.com/1', 'https://b.com/1'])
  })

  it('dedup por url e capa em MAX_WEB_RESULTS', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    mockFetch(() =>
      webBody([
        { title: 'r1', url: 'https://a.com/1' },
        { title: 'r1-dup', url: 'https://a.com/1' },
        { title: 'r2', url: 'https://a.com/2' },
        { title: 'r3', url: 'https://a.com/3' },
        { title: 'r4', url: 'https://a.com/4' },
        { title: 'r5', url: 'https://a.com/5' },
        { title: 'r6', url: 'https://a.com/6' },
      ]),
    )
    const out = await provider.search('x', { allowlist: ['a.com'] })
    expect(out).toHaveLength(MAX_WEB_RESULTS)
    expect(new Set(out.map((r) => r.url)).size).toBe(MAX_WEB_RESULTS)
  })

  it('re-filtra um link OFF-allowlist devolvido pelo provedor (defesa em profundidade)', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    mockFetch(() =>
      webBody([
        { title: 'ok', url: 'https://a.com/ok' },
        { title: 'evil', url: 'https://evil.test/x' },
      ]),
    )
    const out = await provider.search('x', { allowlist: ['a.com'] })
    expect(out.map((r) => r.url)).toEqual(['https://a.com/ok'])
  })

  it('limita o fan-out a MAX_SITE_QUERIES domínios', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    const { calls } = mockFetch(() => webBody([]))
    const many = Array.from({ length: 20 }, (_, i) => `d${i}.com`)
    await provider.search('x', { allowlist: many })
    expect(calls).toHaveLength(MAX_SITE_QUERIES)
  })
})

describe('RealWebSearchProvider (#271) — degradação graciosa (NUNCA lança)', () => {
  it('HTTP não-ok (401/429/5xx) → []', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    mockFetch(() => ({ ok: false, status: 429, body: {} }))
    await expect(provider.search('x', { allowlist: ['a.com'] })).resolves.toEqual([])
  })

  it('erro de rede (fetch lança) → []', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    mockFetch(() => ({ throw: true }))
    await expect(provider.search('x', { allowlist: ['a.com'] })).resolves.toEqual([])
  })

  it('JSON com formas inesperadas (web ausente / results null / results não-array) → []', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    for (const body of [{ unexpected: true }, { web: null }, { web: { results: null } }, { web: { results: 'x' } }]) {
      mockFetch(() => ({ ok: true, body }))
      await expect(provider.search('x', { allowlist: ['a.com'] })).resolves.toEqual([])
      vi.unstubAllGlobals()
    }
  })

  it('falha PARCIAL: um domínio erra, o outro entrega (merge resiliente)', async () => {
    vi.stubEnv('WEB_SEARCH_API_KEY', KEY)
    mockFetch((url) => {
      const q = new URL(url).searchParams.get('q') ?? ''
      if (q.includes('site:bad.com')) return { throw: true }
      return webBody([{ title: 'G', url: 'https://good.com/1' }])
    })
    const out = await provider.search('x', { allowlist: ['good.com', 'bad.com'] })
    expect(out.map((r) => r.url)).toEqual(['https://good.com/1'])
  })
})
