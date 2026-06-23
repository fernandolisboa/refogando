/**
 * Testes do `proxy.ts` (issue #228/#230, ADR-0020). Exercita o wrapper sobre o núcleo PURO:
 * que ele devolve o STATUS e o Location certos, anexa `Vary: Accept-Language`, preserva a
 * query e NÃO entra em loop num caminho já prefixado. A lógica de DECISÃO em si tem seu
 * próprio teste (`locale-path.test.ts`); aqui é a tradução pra `NextResponse`.
 *
 * O proxy é ASYNC desde #230 (pode resolver slug no DB pro 301 do UUID legado), então os testes
 * `await`. Estes casos usam SÓ caminhos que NÃO casam a forma `/{locale}/recipes/<uuid>` — então
 * nenhum toca o DB (roda no projeto "ui", jsdom). O 301 gateado UUID→slug (que lê o DB) é coberto
 * na integração (`recipe-public-by-slug.test.ts` / CI).
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
  it('raiz / → 302 pro locale detectado por cookie, com Vary: Accept-Language', async () => {
    const res = await proxy(req('/', { cookie: 'locale=en-US' }))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en-US')
    expect(res.headers.get('vary')).toBe('Accept-Language')
  })

  it('raiz / → 302 por Accept-Language quando não há cookie', async () => {
    const res = await proxy(req('/', { acceptLanguage: 'en-US,en;q=0.9' }))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/en-US')
  })

  it('raiz / → 302 pro DEFAULT pt-BR sem cookie nem Accept-Language', async () => {
    const res = await proxy(req('/'))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pt-BR')
  })

  it('o redirect da raiz NUNCA é 301', async () => {
    expect((await proxy(req('/'))).status).not.toBe(301)
  })

  it('caminho nu → 302 prefixando e PRESERVANDO a query string', async () => {
    const res = await proxy(req('/recipes?q=bolo', { cookie: 'locale=pt-BR' }))
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.pathname).toBe('/pt-BR/recipes')
    expect(loc.search).toBe('?q=bolo')
  })

  it('caminho já prefixado corretamente (slug, NÃO uuid) → segue (NÃO redireciona), com Vary', async () => {
    const res = await proxy(req('/pt-BR/recipes/bolo-de-cenoura', { cookie: 'locale=en-US' }))
    // NextResponse.next() não é um redirect (status 200), e não traz Location. Não toca o DB:
    // o segmento é um SLUG, não um UUID (parseLegacyUuidDetailPath → null).
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('vary')).toBe('Accept-Language')
  })

  it('prefixo com case errado → 301 normalizando o case (sem trocar de idioma), SEM Vary', async () => {
    // ADR-0020 decisão 1: normalização de case = canonicalização permanente (301), independente
    // do Accept-Language → NÃO emite `Vary` (não há variação por idioma a proteger).
    const res = await proxy(req('/pt-br/recipes', { cookie: 'locale=en-US' }))
    expect(res.status).toBe(301)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/pt-BR/recipes')
    expect(res.headers.get('vary')).toBeNull()
  })

  it('a normalização de case NUNCA é 302 (é permanente); a detecção NUNCA é 301', async () => {
    const cased = await proxy(req('/EN-us/recipes'))
    expect(cased.status).toBe(301)
    const detect = await proxy(req('/recipes', { acceptLanguage: 'en-US' }))
    expect(detect.status).toBe(302)
  })
})
