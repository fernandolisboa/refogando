import { describe, it, expect, vi, afterEach } from 'vitest'
import { RealRecipeImporter } from '@/server/import/recipe-importer'
import type { DomainRateLimiter } from '@/server/import/rate-limit'
import { MAX_HTML_BYTES, PAGE_TIMEOUT_MS, type AddressLookup } from '@/server/import/web-fetch'

/**
 * Endurecimento SSRF do IMPORTER (#448) — o `fetch` da página agora passa pela MESMA barreira do probe
 * (#273): DNS resolvido ANTES de conectar (anti-rebind), `redirect:'manual'` re-validado por hop (um host
 * allowlistado que devolva 302 p/ `http://169.254.169.254/` NÃO é seguido), streaming com corte em
 * `MAX_HTML_BYTES` e `AbortSignal` de timeout. Aqui provamos a FIAÇÃO com `fetch`/`lookup` mockados
 * (SEM rede, SEM DB): rebind bloqueado, redirect p/ IP privado bloqueado, corpo oversized cortado,
 * timeout dispara. O parse puro é coberto em `test/domain/recipe-import-parse.test.ts`.
 */

const ALLOW_ALL: DomainRateLimiter = { tryAcquire: () => true }

const URL_ALVO = 'https://exemplo.com/receitas/bolo'
const ROBOTS_URL = 'https://exemplo.com/robots.txt'

const PAGE_HTML = `<html lang="pt-BR"><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Bolo de Cenoura',
  recipeIngredient: ['2 ovos'],
  recipeInstructions: ['Misture tudo.'],
})}</script></head><body></body></html>`

const publicLookup: AddressLookup = async () => ['203.0.113.10']
const privateLookup: AddressLookup = async () => ['10.0.0.5'] // rebind: host público resolve p/ privado

/** Response REAL com body = ReadableStream, emitido em pedaços p/ exercitar o loop de leitura capado. */
function streamingResponse(bytes: Uint8Array, opts?: { status?: number; headers?: Record<string, string> }): Response {
  const CHUNK = 64 * 1024
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += CHUNK) controller.enqueue(bytes.slice(i, i + CHUNK))
      controller.close()
    },
  })
  return new Response(stream, { status: opts?.status ?? 200, headers: opts?.headers })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('RealRecipeImporter — SSRF pós-redirect / DNS-rebind (#448)', () => {
  it('host allowlistado que RESOLVE p/ IP privado (rebind) → fetch_failed e ZERO rede (nem robots)', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(String(input))
        return new Response(PAGE_HTML, { status: 200 })
      }),
    )
    const importer = new RealRecipeImporter(ALLOW_ALL, privateLookup)
    const res = await importer.import(URL_ALVO)
    expect(res).toEqual({ ok: false, reason: 'fetch_failed' })
    expect(calls).toEqual([]) // barreira de origem: nada toca a rede (nem o /robots.txt)
  })

  it('redirect 302 p/ IP privado (metadata) → fetch_failed e o host interno NÃO é buscado', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 }) // fail-open
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
      }),
    )
    const res = await new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    expect(res).toEqual({ ok: false, reason: 'fetch_failed' })
    expect(calls).toContain(URL_ALVO)
    expect(calls.some((c) => c.includes('169.254.169.254'))).toBe(false) // o hop interno NÃO é seguido
  })

  it('redirect 301 p/ loopback literal (127.0.0.1) → fetch_failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
        return new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/evil' } })
      }),
    )
    const res = await new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    expect(res).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('redirect p/ host PÚBLICO É seguido e a página final é importada (não regride o follow legítimo)', async () => {
    const FINAL = 'https://destino.com/receita-final'
    const impl = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
      if (url === URL_ALVO) return new Response(null, { status: 301, headers: { location: FINAL } })
      return new Response(PAGE_HTML, { status: 200 })
    })
    vi.stubGlobal('fetch', impl)
    const res = await new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    expect(res.ok).toBe(true)
    expect(impl.mock.calls.map((c) => String(c[0]))).toContain(FINAL) // hop público seguido
  })
})

describe('RealRecipeImporter — DoS (corpo/timeout) (#448)', () => {
  it('corpo ACIMA do cap (streaming, sem content-length) → trunca em MAX_HTML_BYTES e importa o prefixo', async () => {
    const head = new TextEncoder().encode(PAGE_HTML)
    const oversized = new Uint8Array(MAX_HTML_BYTES + 50_000)
    oversized.set(head, 0)
    oversized.fill(0x20, head.length) // resto = espaços (HTML inerte) só p/ estourar o cap
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
        return streamingResponse(oversized)
      }),
    )
    const res = await new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    // O JSON-LD vive no <head> (antes do corte): o prefixo truncado ainda importa (não vira fetch_failed).
    expect(res.ok).toBe(true)
  })

  it('Content-Length declarado ACIMA do cap → fetch_failed (recusa ANTES de bufferizar)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
        return new Response(PAGE_HTML, { status: 200, headers: { 'content-length': String(MAX_HTML_BYTES + 1) } })
      }),
    )
    const res = await new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    expect(res).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('timeout dispara (fetch pendura até o AbortSignal) → fetch_failed', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { signal?: AbortSignal }) => {
        const url = String(input)
        if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
        // Página pendura: só rejeita quando o AbortSignal do timeout dispara (espelha um fetch abortado).
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )
    const p = new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS + 10) // avança o relógio até o timeout do fetch da página
    const res = await p
    expect(res).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('robots proíbe → robots_blocked, sem regressão do guard-rail existente (usa a URL re-validada)', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /receitas', { status: 200 })
        return new Response(PAGE_HTML, { status: 200 })
      }),
    )
    const res = await new RealRecipeImporter(ALLOW_ALL, publicLookup).import(URL_ALVO)
    expect(res).toEqual({ ok: false, reason: 'robots_blocked' })
    expect(calls).toContain(ROBOTS_URL)
    expect(calls).not.toContain(URL_ALVO)
  })
})
