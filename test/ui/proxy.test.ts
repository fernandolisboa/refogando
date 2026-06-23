/**
 * Testes do `proxy.ts` (issue #228, ADR-0020). Exercita o wrapper sobre o núcleo PURO:
 * que ele devolve o STATUS e o Location certos, anexa `Vary: Accept-Language`, preserva a
 * query e NÃO entra em loop num caminho já prefixado. A lógica de DECISÃO em si tem seu
 * próprio teste (`locale-path.test.ts`); aqui é a tradução pra `NextResponse`.
 *
 * O proxy é SÍNCRONO e header-only — só negocia/normaliza locale, sem tocar o DB. A
 * canonicalização do UUID legado → slug NÃO passa por aqui (é um permanentRedirect 308 GATEADO no
 * Server Component da página de detalhe; ver `recipe-public-by-slug.test.ts` / CI), então o proxy
 * não lê banco e roda inteiro no projeto "ui" (jsdom).
 */
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

function req(url: string, init?: { cookie?: string; acceptLanguage?: string }): NextRequest {
  const headers = new Headers()
  if (init?.cookie) headers.set('cookie', init.cookie)
  if (init?.acceptLanguage) headers.set('accept-language', init.acceptLanguage)
  return new NextRequest(new URL(url, 'https://refogando.app'), { headers })
}

describe('proxy', () => {
  it('raiz / → 302 pro locale detectado por cookie, com Vary: Accept-Language', () => {
    const res = proxy(req('/', { cookie: 'locale=en-US' }))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en-US')
    expect(res.headers.get('vary')).toBe('Accept-Language')
  })

  it('raiz / → 302 por Accept-Language quando não há cookie', () => {
    const res = proxy(req('/', { acceptLanguage: 'en-US,en;q=0.9' }))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en-US')
  })

  it('raiz / → 302 pro DEFAULT pt-BR sem cookie nem Accept-Language', () => {
    const res = proxy(req('/'))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pt-BR')
  })

  it('o redirect da raiz NUNCA é 301', () => {
    expect(proxy(req('/')).status).not.toBe(301)
  })

  it('caminho nu → 302 prefixando e PRESERVANDO a query string', () => {
    const res = proxy(req('/recipes?q=bolo', { cookie: 'locale=pt-BR' }))
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/pt-BR/recipes')
    expect(loc.search).toBe('?q=bolo')
  })

  it('caminho já prefixado corretamente → segue (NÃO redireciona), com Vary', () => {
    const res = proxy(req('/pt-BR/recipes/bolo-de-cenoura', { cookie: 'locale=en-US' }))
    // NextResponse.next() não é um redirect (status 200), e não traz Location. O proxy NÃO inspeciona
    // o caminho de detalhe (uuid vs slug): a canonicalização UUID→slug é do server component.
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('vary')).toBe('Accept-Language')
  })

  it('prefixo com case errado → 301 normalizando o case (sem trocar de idioma), SEM Vary', () => {
    // ADR-0020 decisão 1: normalização de case = canonicalização permanente (301), independente
    // do Accept-Language → NÃO emite `Vary` (não há variação por idioma a proteger).
    const res = proxy(req('/pt-br/recipes', { cookie: 'locale=en-US' }))
    expect(res.status).toBe(301)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pt-BR/recipes')
    expect(res.headers.get('vary')).toBeNull()
  })

  it('a normalização de case NUNCA é 302 (é permanente); a detecção NUNCA é 301', () => {
    const cased = proxy(req('/EN-us/recipes'))
    expect(cased.status).toBe(301)
    const detect = proxy(req('/recipes', { acceptLanguage: 'en-US' }))
    expect(detect.status).toBe(302)
  })
})
