import { describe, it, expect, vi, afterEach } from 'vitest'
import type { LookupOptions } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { Agent } from 'undici'
import {
  pinnedLookup,
  pinnedDispatcher,
  resolvePublicAddrs,
  fetchHardenedHtml,
  robotsAllows,
  type AddressLookup,
} from '@/server/import/web-fetch'

/**
 * IP PINADO — fecha o resíduo TOCTOU de DNS-rebind do #448 (achado do code-review de segurança).
 *
 * Antes: `fetchHardenedHtml`/`robotsAllows` validavam o IP resolvido e DEPOIS chamavam `fetch`, que deixava
 * o undici RE-RESOLVER o hostname por conta própria — janela de rebind (TTL=0 devolve IP público na
 * checagem e privado no connect). Agora o host é resolvido UMA vez e os IPs validados são PINADOS num
 * `Agent` do undici (`connect.lookup`), então o `fetch` conecta ao IP JÁ validado; `Host`/SNI TLS seguem o
 * hostname original. Estes testes provam a garantia SEM rede (fetch/dns mockados, sem DB): a resolução é
 * única e pinada, um IP privado é bloqueado ANTES de qualquer socket, e a URL não é reescrita p/ IP (SNI).
 */

const URL_ALVO = 'https://exemplo.com/receitas/bolo'
const PAGE_HTML = `<html lang="pt-BR"><head><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Bolo de Cenoura',
  recipeIngredient: ['2 ovos'],
  recipeInstructions: ['Misture tudo.'],
})}</script></head><body></body></html>`

const publicLookup: AddressLookup = async () => ['203.0.113.10']

/** Invoca a lookup (assinatura de `dns.lookup`) e captura os argumentos do callback. */
function callLookup(fn: LookupFunction, hostname: string, options: LookupOptions) {
  return new Promise<{ err: Error | null; address: string | { address: string; family: number }[]; family?: number }>(
    (resolve) => {
      fn(hostname, options, (err, address, family) => resolve({ err, address, family }))
    },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pinnedLookup — pin no IP validado (elimina a 2ª resolução)', () => {
  it('IGNORA o hostname e devolve SEMPRE o IP validado (uma tentativa de rebind na 2ª resolução é ignorada)', async () => {
    const lookup = pinnedLookup(['203.0.113.10'])
    // hostname que numa 2ª resolução maliciosa apontaria p/ o metadata — aqui é ignorado por completo
    const r = await callLookup(lookup, 'evil-rebind.example', {})
    expect(r.err).toBeNull()
    expect(r.address).toBe('203.0.113.10')
    expect(r.family).toBe(4)
  })

  it('honra options.all devolvendo [{address,family}] (v4 e v6)', async () => {
    const lookup = pinnedLookup(['203.0.113.10', '2606:4700::1111'])
    const r = await callLookup(lookup, 'exemplo.com', { all: true })
    expect(r.err).toBeNull()
    expect(r.address).toEqual([
      { address: '203.0.113.10', family: 4 },
      { address: '2606:4700::1111', family: 6 },
    ])
  })

  it('DEFESA DUPLA: se o IP pinado for privado (rebind), ERRA no connect — nenhum socket abre', async () => {
    const lookup = pinnedLookup(['169.254.169.254']) // metadata link-local
    const r = await callLookup(lookup, 'exemplo.com', {})
    expect(r.err).toBeInstanceOf(Error)
  })
})

describe('resolvePublicAddrs — resolução ÚNICA validada (fonte dos IPs pinados)', () => {
  it('todos públicos → devolve os addrs', async () => {
    expect(await resolvePublicAddrs('exemplo.com', async () => ['203.0.113.10'])).toEqual(['203.0.113.10'])
  })

  it('QUALQUER endereço privado → null (bloqueado antes de qualquer socket)', async () => {
    expect(await resolvePublicAddrs('exemplo.com', async () => ['203.0.113.10', '169.254.169.254'])).toBeNull()
  })

  it('zero endereços → null', async () => {
    expect(await resolvePublicAddrs('exemplo.com', async () => [])).toBeNull()
  })

  it('erro de resolução → null (nunca lança)', async () => {
    expect(
      await resolvePublicAddrs('exemplo.com', async () => {
        throw new Error('dns down')
      }),
    ).toBeNull()
  })
})

describe('pinnedDispatcher', () => {
  it('constrói um Agent do undici (dispatcher válido para o fetch global)', async () => {
    const d = pinnedDispatcher(['203.0.113.10'])
    expect(d).toBeInstanceOf(Agent)
    await d.destroy()
  })
})

describe('fetchHardenedHtml — conecta pelo IP pinado e preserva o hostname (Host/SNI)', () => {
  it('passa um Agent pinado no init.dispatcher e NÃO reescreve a URL p/ IP (SNI/Host = hostname)', async () => {
    let capturedUrl: string | undefined
    let capturedDispatcher: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { dispatcher?: unknown }) => {
        capturedUrl = String(input)
        capturedDispatcher = init?.dispatcher
        return new Response(PAGE_HTML, { status: 200 })
      }),
    )
    const page = await fetchHardenedHtml(URL_ALVO, publicLookup)
    expect(page?.finalUrl).toContain('exemplo.com')
    // URL preservada com o hostname (não trocada por 203.0.113.10) ⇒ Host header + servername TLS corretos
    expect(capturedUrl).toContain('exemplo.com')
    expect(capturedUrl).not.toContain('203.0.113.10')
    // o pin vem do dispatcher (Agent com connect.lookup), não da reescrita da URL
    expect(capturedDispatcher).toBeInstanceOf(Agent)
  })

  it('host que resolve p/ IP privado → null e ZERO fetch (bloqueado antes do socket)', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(String(input))
        return new Response(PAGE_HTML, { status: 200 })
      }),
    )
    const privateLookup: AddressLookup = async () => ['169.254.169.254']
    const page = await fetchHardenedHtml(URL_ALVO, privateLookup)
    expect(page).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('robotsAllows — MESMA pinagem no fetch do /robots.txt', () => {
  it('resolve+pina: passa dispatcher pinado e busca o /robots.txt da origem', async () => {
    let capturedDispatcher: unknown
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: { dispatcher?: unknown }) => {
        capturedDispatcher = init?.dispatcher
        expect(String(input)).toContain('/robots.txt')
        return new Response('User-agent: *\nDisallow: /receitas', { status: 200 })
      }),
    )
    const allowed = await robotsAllows(URL_ALVO, 'RefogandoBot', publicLookup)
    expect(allowed).toBe(false) // o Disallow casou (a fiação funcionou)
    expect(capturedDispatcher).toBeInstanceOf(Agent)
  })

  it('origem que resolve p/ IP privado → NÃO busca robots e fail-open (true), sem tocar a rede', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        calls.push(String(input))
        return new Response('', { status: 200 })
      }),
    )
    const privateLookup: AddressLookup = async () => ['10.0.0.5']
    const allowed = await robotsAllows(URL_ALVO, 'RefogandoBot', privateLookup)
    expect(allowed).toBe(true)
    expect(calls).toEqual([])
  })
})
