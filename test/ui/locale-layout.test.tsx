import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

/**
 * Teste do LocaleLayout (#228/ADR-0020) — AC explícito: "<html lang> reflete o locale corrente"
 * + validação de param de locale (defesa em profundidade no layout, além do proxy).
 *
 * O layout é um Server Component AWAITABLE: invocamos a função direto e inspecionamos a ÁRVORE de
 * elementos React que ela devolve (sem montar no jsdom — `<html>`/`<body>` não rendem bem em
 * jsdom, e o foco é o WIRING: lang canônico + initialLocale do PATH + notFound no desconhecido).
 * Mockamos `next/headers` (cookies), `next/navigation` (notFound como sentinela) e os filhos
 * pesados (SiteHeader/SiteFooter) — o que importa é o nó <html> e o LocaleProvider.
 */

// `vi.mock` é içado pro topo do arquivo; as referências que a factory usa precisam vir de
// `vi.hoisted` (içado junto), senão acessamos a const antes da inicialização.
const { NotFoundSignal, notFound, cookieGet } = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  return {
    NotFoundSignal,
    notFound: vi.fn(() => {
      throw new NotFoundSignal('NEXT_NOT_FOUND')
    }),
    cookieGet: vi.fn<(name: string) => { value: string } | undefined>(() => undefined),
  }
})
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: cookieGet }),
}))

// Filhos pesados → stubs leves (o foco é o <html lang> + o initialLocale do provider).
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }))
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }))
vi.mock('@/i18n/provider', () => ({
  LocaleProvider: ({ initialLocale, children }: { initialLocale: string; children: ReactNode }) => (
    <div data-testid="locale-provider" data-initial-locale={initialLocale}>
      {children}
    </div>
  ),
}))
// #317: o layout passou a semear o vocabulário de cozinha (leitor DB → contexto). No jsdom não
// há DB; mockamos o leitor p/ `[]` e o provider p/ passar os filhos — o foco do teste segue
// sendo o <html lang> + initialLocale, não a faceta de cozinha.
vi.mock('@/server/vocabulary/load', () => ({ loadVocabulary: async () => [] }))
vi.mock('@/components/i18n/cozinha-vocab-provider', () => ({
  CozinhaVocabProvider: ({ children }: { children: ReactNode }) => children,
}))

import LocaleLayout from '@/app/[locale]/layout'

type ElementWithProps = { props: Record<string, unknown> }
/** Acha o 1º nó cujo props casa o predicado, BFS na árvore de elementos React devolvida. */
function findNode(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
): ElementWithProps | null {
  if (!node || typeof node !== 'object') return null
  const el = node as { props?: Record<string, unknown> }
  if (el.props && match(el.props)) return el as ElementWithProps
  const children = el.props?.children
  const arr = Array.isArray(children) ? children : children != null ? [children] : []
  for (const c of arr) {
    const hit = findNode(c, match)
    if (hit) return hit
  }
  return null
}

beforeEach(() => {
  notFound.mockClear()
  cookieGet.mockReset()
  cookieGet.mockReturnValue(undefined)
})

describe('LocaleLayout (#228)', () => {
  it('locale do PATH desconhecido → notFound() (validação de param, defesa em profundidade)', async () => {
    await expect(
      LocaleLayout({
        children: <span>x</span>,
        params: Promise.resolve({ locale: 'xx-YY' }),
      }),
    ).rejects.toBeInstanceOf(NotFoundSignal)
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('<html lang> reflete o locale CANÔNICO do path (não o cookie)', async () => {
    // Cookie em pt-BR, path em en-US: a URL é a verdade do idioma → lang = en-US (não o cookie).
    cookieGet.mockImplementation((name: string) =>
      name === 'locale' ? { value: 'pt-BR' } : undefined,
    )
    const tree = await LocaleLayout({
      children: <span>x</span>,
      params: Promise.resolve({ locale: 'en-US' }),
    })

    const html = findNode(tree, (p) => typeof p.lang === 'string')
    expect(html?.props.lang).toBe('en-US')
  })

  it('canoniza o case do segmento de path no <html lang> e no initialLocale do provider', async () => {
    // (Mesmo o proxy já normalizando o case, o layout canoniza por dentro — nunca emite 'EN-us'.)
    const tree = await LocaleLayout({
      children: <span>x</span>,
      params: Promise.resolve({ locale: 'EN-us' }),
    })

    const html = findNode(tree, (p) => typeof p.lang === 'string')
    expect(html?.props.lang).toBe('en-US')

    // initialLocale do LocaleProvider vem do PATH (não do cookie), na forma canônica.
    const provider = findNode(tree, (p) => 'initialLocale' in p)
    expect(provider?.props.initialLocale).toBe('en-US')
  })
})
