import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'

/**
 * Teste do LocaleLayout (#228/ADR-0020) — AC explícito: "<html lang> reflete o locale corrente"
 * + validação de param de locale (defesa em profundidade no layout, além do proxy).
 *
 * O layout é um Server Component AWAITABLE: invocamos a função direto e inspecionamos a ÁRVORE de
 * elementos React que ela devolve (sem montar no jsdom — `<html>`/`<body>` não rendem bem em
 * jsdom, e o foco é o WIRING: lang canônico + initialLocale do PATH + notFound no desconhecido).
 * Mockamos `next/navigation` (notFound como sentinela), `next/server` (`connection`), as leituras
 * cacheadas do layout e os filhos pesados (SiteHeader/SiteFooter).
 *
 * Achado A da auditoria de performance (handoff 67): o layout NÃO lê mais cookie nem header (seria
 * dinâmico em toda rota). `next/headers` fica mockado com espiões que FALHAM o teste se chamados; o tema
 * sai como `DEFAULT_THEME_CLASS` + o script pré-pintura no `<head>`.
 */

// `vi.mock` é içado pro topo do arquivo; as referências que a factory usa precisam vir de
// `vi.hoisted` (içado junto), senão acessamos a const antes da inicialização.
const { NotFoundSignal, notFound, cookies, headers, connection, loadVocab, loadConfig } = vi.hoisted(() => {
  class NotFoundSignal extends Error {}
  return {
    NotFoundSignal,
    notFound: vi.fn(() => {
      throw new NotFoundSignal('NEXT_NOT_FOUND')
    }),
    cookies: vi.fn(async () => ({ get: () => undefined })),
    headers: vi.fn(async () => new Headers()),
    connection: vi.fn(async () => {}),
    loadVocab: vi.fn<() => Promise<unknown[]>>(async () => []),
    loadConfig: vi.fn<() => Promise<{ variantEnabled: boolean; socialLinks: unknown[] }>>(async () => ({
      variantEnabled: false,
      socialLinks: [],
    })),
  }
})
vi.mock('next/navigation', () => ({ notFound }))
vi.mock('next/headers', () => ({ cookies, headers }))
vi.mock('next/server', () => ({ connection }))
// Leituras do layout (Data Cache com tag, src/server/layout-data.ts). No jsdom não há DB.
vi.mock('@/server/layout-data', () => ({
  loadLayoutCozinhaVocab: loadVocab,
  loadLayoutAppConfig: loadConfig,
}))
vi.mock('@/server/deps', () => ({ getDb: () => ({}) }))

// Filhos pesados → stubs leves (o foco é o <html lang> + o initialLocale do provider). O footer devolve
// um marcador com os links que recebeu, para conferir o que o layout passa.
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }))
vi.mock('@/components/nav/section-tabs', () => ({ SectionTabs: () => null }))
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }))
vi.mock('@/i18n/provider', () => ({
  LocaleProvider: ({ initialLocale, children }: { initialLocale: string; children: ReactNode }) => (
    <div data-testid="locale-provider" data-initial-locale={initialLocale}>
      {children}
    </div>
  ),
}))
// #317: o layout semeia o vocabulário de cozinha (leitor → contexto); o provider só passa os filhos.
vi.mock('@/components/i18n/cozinha-vocab-provider', () => ({
  CozinhaVocabProvider: ({ children }: { children: ReactNode }) => children,
}))

import LocaleLayout from '@/app/[locale]/layout'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { THEME_INIT_SCRIPT } from '@/lib/theme-script'

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
  cookies.mockClear()
  headers.mockClear()
  connection.mockClear()
  loadVocab.mockReset()
  loadVocab.mockResolvedValue([])
  loadConfig.mockReset()
  loadConfig.mockResolvedValue({ variantEnabled: false, socialLinks: [] })
})

function render(locale = 'pt-BR') {
  return LocaleLayout({ children: <span>x</span>, params: Promise.resolve({ locale }) })
}

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

  it('<html lang> reflete o locale CANÔNICO do path', async () => {
    // A URL é a verdade do idioma (o layout nem lê o cookie de locale).
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

  // #461 (a11y): skip-link localizado antes do header + alvo `#conteudo` focável (tabIndex -1).
  it('skip-link "pular para o conteúdo" aponta pro alvo #conteudo (focável), no locale do path', async () => {
    const tree = await LocaleLayout({
      children: <span>x</span>,
      params: Promise.resolve({ locale: 'pt-BR' }),
    })
    // A âncora do skip-link leva a `#conteudo` e mostra o rótulo localizado.
    const skip = findNode(tree, (p) => p.href === '#conteudo')
    expect(skip).not.toBeNull()
    expect(skip?.props.children).toBe(ptBR.nav.pularParaConteudo)
    // O alvo existe e é FOCÁVEL programaticamente (id + tabIndex -1, sem virar tab stop).
    const target = findNode(tree, (p) => p.id === 'conteudo')
    expect(target).not.toBeNull()
    expect(target?.props.tabIndex).toBe(-1)
  })

  it('skip-link usa o rótulo en-US quando o path é en-US', async () => {
    const tree = await LocaleLayout({
      children: <span>x</span>,
      params: Promise.resolve({ locale: 'en-US' }),
    })
    const skip = findNode(tree, (p) => p.href === '#conteudo')
    expect(skip?.props.children).toBe(enUS.nav.pularParaConteudo)
  })

  // Achado A (handoff 67): nada do request no layout, tema por script.
  describe('tema e dados do layout sem ler o request (achado A)', () => {
    it('não chama cookies() nem headers(): o layout pode ser estático', async () => {
      await render('pt-BR')
      expect(cookies).not.toHaveBeenCalled()
      expect(headers).not.toHaveBeenCalled()
    })

    it('<html> sai com a classe padrão (claro) + suppressHydrationWarning; o <head> leva o script do tema', async () => {
      const tree = await render('pt-BR')
      const html = findNode(tree, (p) => typeof p.lang === 'string')
      expect(html?.props.className).toBe('light')
      expect(html?.props.suppressHydrationWarning).toBe(true)
      const script = findNode(tree, (p) => {
        const inner = p.dangerouslySetInnerHTML as { __html?: string } | undefined
        return inner?.__html === THEME_INIT_SCRIPT
      })
      expect(script).not.toBeNull()
    })

    it('semeia as cozinhas localizadas e passa ao footer só os links que o loader devolveu', async () => {
      loadVocab.mockResolvedValue([{ slug: 'italiana', labelPtBr: 'Italiana', labelEnUs: 'Italian', sort: 0 }])
      const link = { platform: 'instagram', url: 'https://www.instagram.com/refogando', enabled: true }
      loadConfig.mockResolvedValue({ variantEnabled: true, socialLinks: [link] })

      const tree = await render('en-US')
      const vocab = findNode(tree, (p) => Array.isArray(p.value))
      expect(vocab?.props.value).toEqual([{ value: 'italiana', label: 'Italian' }])
      const variant = findNode(tree, (p) => typeof p.enabled === 'boolean')
      expect(variant?.props.enabled).toBe(true)
      const footer = findNode(tree, (p) => Array.isArray(p.socialLinks))
      expect(footer?.props.socialLinks).toEqual([link])
      expect(footer?.props).not.toHaveProperty('initialTheme')
      // Leitura bem-sucedida: nada força a rota a ser dinâmica.
      expect(connection).not.toHaveBeenCalled()
    })

    it.each([
      ['vocabulário', () => loadVocab.mockRejectedValue(new Error('neon'))],
      ['app_config', () => loadConfig.mockRejectedValue(new Error('neon'))],
    ])('falha ao ler %s: degrada (nunca tela quebrada) e chama connection() para não cachear a degradação', async (_nome, falhar) => {
      falhar()
      const tree = await render('pt-BR')
      expect(findNode(tree, (p) => typeof p.lang === 'string')).not.toBeNull()
      expect(connection).toHaveBeenCalledTimes(1)
    })

    it('as duas leituras começam juntas (em paralelo), não uma depois da outra', async () => {
      let release!: (terms: unknown[]) => void
      loadVocab.mockReturnValue(new Promise<unknown[]>((resolve) => (release = resolve)))
      const pending = render('pt-BR')
      // O vocabulário ainda não respondeu e a config já foi pedida.
      await vi.waitFor(() => expect(loadConfig).toHaveBeenCalledTimes(1))
      release([])
      await pending
    })

    it('uma leitura falha e a outra não: só a que falhou degrada', async () => {
      loadVocab.mockRejectedValue(new Error('neon'))
      const link = { platform: 'instagram', url: 'https://www.instagram.com/refogando', enabled: true }
      loadConfig.mockResolvedValue({ variantEnabled: true, socialLinks: [link] })
      const tree = await render('pt-BR')
      expect(findNode(tree, (p) => Array.isArray(p.value))?.props.value).toEqual([])
      expect(findNode(tree, (p) => typeof p.enabled === 'boolean')?.props.enabled).toBe(true)
      expect(findNode(tree, (p) => Array.isArray(p.socialLinks))?.props.socialLinks).toEqual([link])
      expect(connection).toHaveBeenCalledTimes(1)
    })

    it('degradado: sem cozinhas, "gerar 2" desligado e footer sem links', async () => {
      loadVocab.mockRejectedValue(new Error('neon'))
      loadConfig.mockRejectedValue(new Error('neon'))
      const tree = await render('pt-BR')
      expect(findNode(tree, (p) => Array.isArray(p.value))?.props.value).toEqual([])
      expect(findNode(tree, (p) => typeof p.enabled === 'boolean')?.props.enabled).toBe(false)
      expect(findNode(tree, (p) => Array.isArray(p.socialLinks))?.props.socialLinks).toEqual([])
      expect(connection).toHaveBeenCalledTimes(1)
    })
  })
})
