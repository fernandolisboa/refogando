import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * "Salvos" na nav (#468). A página `/me/saved` (coleções, #364) existia mas NENHUMA chrome linkava
 * pra ela. Agora ela aparece na nav do header, só pra quem está logado, ao lado de "Minhas criações"
 * e com estado ativo — mesmo lugar e mesmo gating da vizinha (que também não está no menu da conta).
 * O drawer mobile é coberto em `site-header-mobile.test.tsx`. Visitante não vê o link.
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

const SALVOS = ptBR.colecoes.titulo

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

// A nav inline do desktop é o 1º <nav> do header (o drawer mobile só monta ao abrir).
function desktopNav() {
  return screen.getAllByRole('navigation')[0]
}

afterEach(() => {
  authMock.current = authMock.anon
  nav.pathname = '/pt-BR'
})

describe('Header — "Salvos" na chrome (#468)', () => {
  it('logado: a nav do desktop linka "Salvos" para /me/saved, depois de "Minhas criações"', () => {
    authMock.current = logged
    renderHeader()
    const links = within(desktopNav()).getAllByRole('link')
    const labels = links.map((a) => a.textContent)
    expect(labels.indexOf(SALVOS)).toBe(labels.indexOf(ptBR.minhasCriacoes.titulo) + 1)
    expect(within(desktopNav()).getByRole('link', { name: SALVOS })).toHaveAttribute(
      'href',
      '/me/saved',
    )
  })

  it('logado: em /me/saved o link "Salvos" fica ativo (aria-current=page)', () => {
    authMock.current = logged
    nav.pathname = '/pt-BR/me/saved'
    renderHeader()
    expect(within(desktopNav()).getByRole('link', { name: SALVOS })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      within(desktopNav()).getByRole('link', { name: ptBR.minhasCriacoes.titulo }),
    ).not.toHaveAttribute('aria-current')
  })

  it('Visitante: nenhum "Salvos" no header', () => {
    renderHeader()
    expect(screen.queryByText(SALVOS)).not.toBeInTheDocument()
  })
})
