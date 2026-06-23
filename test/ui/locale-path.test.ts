/**
 * Testes do núcleo PURO de roteamento por locale-no-caminho (issue #228, ADR-0020).
 * Sem `next/*`, sem DB: só a decisão "dado um pathname + headers, qual redirect?".
 * É o seam que mantém o `proxy.ts` fininho e a lógica verificável no projeto "ui" (sem banco).
 */
import { describe, it, expect } from 'vitest'
import {
  splitLocalePrefix,
  decideLocaleRedirect,
  localePrefixedPath,
} from '@/i18n/locale-path'

describe('splitLocalePrefix', () => {
  it('reconhece um prefixo de locale canônico e devolve o resto', () => {
    expect(splitLocalePrefix('/pt-BR/recipes')).toEqual({
      locale: 'pt-BR',
      canonical: true,
      rest: '/recipes',
    })
    expect(splitLocalePrefix('/en-US/recipes/carrot-cake')).toEqual({
      locale: 'en-US',
      canonical: true,
      rest: '/recipes/carrot-cake',
    })
  })

  it('reconhece o locale numa raiz nua (sem rota depois)', () => {
    expect(splitLocalePrefix('/pt-BR')).toEqual({
      locale: 'pt-BR',
      canonical: true,
      rest: '/',
    })
    // com barra final
    expect(splitLocalePrefix('/en-US/')).toEqual({
      locale: 'en-US',
      canonical: true,
      rest: '/',
    })
  })

  it('casa case-insensitive mas marca como NÃO-canônico (precisa normalizar)', () => {
    expect(splitLocalePrefix('/pt-br/recipes')).toEqual({
      locale: 'pt-BR',
      canonical: false,
      rest: '/recipes',
    })
    expect(splitLocalePrefix('/EN-us')).toEqual({
      locale: 'en-US',
      canonical: false,
      rest: '/',
    })
  })

  it('devolve locale null quando o 1º segmento não é um locale suportado', () => {
    expect(splitLocalePrefix('/recipes')).toEqual({
      locale: null,
      canonical: false,
      rest: '/recipes',
    })
    expect(splitLocalePrefix('/')).toEqual({ locale: null, canonical: false, rest: '/' })
    // 'pt' nu (sem região) NÃO é um locale suportado no caminho (formato pt-BR/en-US exato)
    expect(splitLocalePrefix('/pt/recipes')).toEqual({
      locale: null,
      canonical: false,
      rest: '/pt/recipes',
    })
  })
})

describe('localePrefixedPath', () => {
  it('monta /{locale}{rest} preservando a rota', () => {
    expect(localePrefixedPath('pt-BR', '/recipes')).toBe('/pt-BR/recipes')
    expect(localePrefixedPath('en-US', '/recipes/carrot-cake')).toBe(
      '/en-US/recipes/carrot-cake',
    )
  })

  it('a raiz nua vira só /{locale} (sem barra final pendurada)', () => {
    expect(localePrefixedPath('pt-BR', '/')).toBe('/pt-BR')
    expect(localePrefixedPath('en-US', '')).toBe('/en-US')
  })
})

describe('decideLocaleRedirect', () => {
  it('raiz / → 302 pro locale detectado (cookie tem prioridade)', () => {
    expect(
      decideLocaleRedirect({ pathname: '/', cookieLocale: 'en-US', acceptLanguage: null }),
    ).toEqual({ to: '/en-US', status: 302 })
  })

  it('raiz / → 302 pro Accept-Language quando não há cookie', () => {
    expect(
      decideLocaleRedirect({
        pathname: '/',
        cookieLocale: null,
        acceptLanguage: 'en-US,en;q=0.9',
      }),
    ).toEqual({ to: '/en-US', status: 302 })
  })

  it('raiz / → 302 pro DEFAULT (pt-BR) sem cookie nem Accept-Language', () => {
    expect(
      decideLocaleRedirect({ pathname: '/', cookieLocale: null, acceptLanguage: null }),
    ).toEqual({ to: '/pt-BR', status: 302 })
  })

  it('caminho nu (não-prefixado) → 302 prefixando com o locale detectado, preservando a rota', () => {
    expect(
      decideLocaleRedirect({
        pathname: '/recipes/carrot-cake',
        cookieLocale: 'en-US',
        acceptLanguage: null,
      }),
    ).toEqual({ to: '/en-US/recipes/carrot-cake', status: 302 })
  })

  it('NÃO redireciona um caminho já corretamente prefixado (sem loop)', () => {
    expect(
      decideLocaleRedirect({
        pathname: '/pt-BR/recipes',
        cookieLocale: 'en-US',
        acceptLanguage: null,
      }),
    ).toBeNull()
    expect(
      decideLocaleRedirect({
        pathname: '/en-US',
        cookieLocale: 'pt-BR',
        acceptLanguage: null,
      }),
    ).toBeNull()
  })

  it('normaliza o case do prefixo de locale (/pt-br/... → /pt-BR/...) sem trocar de idioma, com 301 permanente', () => {
    // ADR-0020 decisão 1: a normalização de case é canonicalização permanente (Accept-Language-
    // independente) → 301, NÃO 302. Consolida a variante lowercase na URL canônica (SEO).
    expect(
      decideLocaleRedirect({
        pathname: '/pt-br/recipes',
        cookieLocale: 'en-US',
        acceptLanguage: null,
      }),
    ).toEqual({ to: '/pt-BR/recipes', status: 301 })
  })

  it('o redirect de DETECÇÃO (raiz/não-prefixado) é 302 — NUNCA 301 (depende do Accept-Language)', () => {
    const root = decideLocaleRedirect({ pathname: '/', cookieLocale: null, acceptLanguage: null })
    const bare = decideLocaleRedirect({
      pathname: '/recipes/carrot-cake',
      cookieLocale: null,
      acceptLanguage: null,
    })
    expect(root?.status).toBe(302)
    expect(bare?.status).toBe(302)
  })

  it('o redirect de NORMALIZAÇÃO DE CASE é 301 (permanente, Accept-Language-independente)', () => {
    const cased = decideLocaleRedirect({
      pathname: '/EN-us/recipes',
      cookieLocale: null,
      acceptLanguage: null,
    })
    expect(cased?.status).toBe(301)
  })
})
