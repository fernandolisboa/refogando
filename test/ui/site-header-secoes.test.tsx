import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Header em 3 seções (ADR-0043): a nav do desktop mostra Explorar, Minhas receitas e Planejar (as
 * páginas viraram subabas na `SectionTabs`). A seção fica ativa em qualquer aba dela, e o link das seções
 * pessoais leva à última aba visitada. O drawer mobile é coberto em `site-header-mobile.test.tsx`.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const nav = vi.hoisted(() => ({ pathname: '/pt-BR' as string | null }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

const authMock = vi.hoisted(() => {
  const anon = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }
  return { anon, current: anon as unknown }
})
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.current,
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SiteHeader } from '@/components/site-header'
import { rememberTab } from '@/components/nav/last-tab-store'
import { LAST_TAB_STORAGE_KEY } from '@/domain/nav-sections'

const logged = {
  data: { user: { id: 'u1', name: 'X', email: 'x@y.z', role: 'user', handle: 'x', deletedAt: null } },
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: () => {},
}

function renderHeader() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SiteHeader />
    </LocaleProvider>,
  )
}

const desktopNav = () => screen.getAllByRole('navigation')[0]
const sectionLink = (name: string) => within(desktopNav()).getByRole('link', { name })

afterEach(() => {
  authMock.current = authMock.anon
  nav.pathname = '/pt-BR'
  window.localStorage.clear()
})

describe('Header — seções (ADR-0043)', () => {
  it('logado: Explorar → /, Minhas receitas → /me/recipes, Planejar → /me/meal-plan', () => {
    authMock.current = logged
    renderHeader()
    const links = within(desktopNav()).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      [ptBR.nav.home, '/'],
      [ptBR.nav.minhasReceitas, '/me/recipes'],
      [ptBR.nav.planejar, '/me/meal-plan'],
    ])
  })

  it('Visitante: só Explorar', () => {
    renderHeader()
    expect(within(desktopNav()).getAllByRole('link').map((a) => a.textContent)).toEqual([ptBR.nav.home])
  })

  it('a seção fica ativa em qualquer aba: "page" no próprio destino, "true" nas outras', () => {
    authMock.current = logged
    nav.pathname = '/pt-BR/me/meal-plan'
    const { unmount } = renderHeader()
    expect(sectionLink(ptBR.nav.planejar)).toHaveAttribute('aria-current', 'page')
    expect(sectionLink(ptBR.nav.minhasReceitas)).not.toHaveAttribute('aria-current')
    unmount()

    nav.pathname = '/pt-BR/me/shopping-lists/0b5c'
    renderHeader()
    expect(sectionLink(ptBR.nav.planejar)).toHaveAttribute('aria-current', 'true')
  })

  it('fora das seções (receita, perfil, guia) nenhuma fica ativa', () => {
    authMock.current = logged
    nav.pathname = '/pt-BR/guia'
    renderHeader()
    for (const a of within(desktopNav()).getAllByRole('link')) expect(a).not.toHaveAttribute('aria-current')
  })

  it('Planejar e Minhas receitas levam à última aba visitada', () => {
    authMock.current = logged
    renderHeader()
    act(() => {
      rememberTab('planejar', '/me/pantry')
      rememberTab('minhasReceitas', '/me/saved')
    })
    expect(sectionLink(ptBR.nav.planejar)).toHaveAttribute('href', '/me/pantry')
    expect(sectionLink(ptBR.nav.minhasReceitas)).toHaveAttribute('href', '/me/saved')
    expect(sectionLink(ptBR.nav.home)).toHaveAttribute('href', '/')
  })

  it('lembrança adulterada no storage é ignorada', () => {
    authMock.current = logged
    window.localStorage.setItem(LAST_TAB_STORAGE_KEY, JSON.stringify({ planejar: 'https://evil.example' }))
    renderHeader()
    expect(sectionLink(ptBR.nav.planejar)).toHaveAttribute('href', '/me/meal-plan')
  })
})
