import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Pontos de entrada do guia e âncoras do tour (ADR-0039): o header marca com `data-tour` o que o tour
 * destaca (busca, Criar, Salvos, Cardápio, conta, botão do menu mobile); "Como usar" (/guia) aparece
 * no menu da conta e no rodapé (este também para o Visitante).
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
import { SiteFooter } from '@/components/site-footer'
import { AuthSlot } from '@/components/auth-slot'

const logged = {
  data: { user: { id: 'u1', name: 'Ana', email: 'a@b.c', role: 'user', handle: 'ana' } },
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: () => {},
}

const wrap = (node: ReactNode) => <LocaleProvider initialLocale="pt-BR">{node}</LocaleProvider>
const anchor = (id: string) => document.querySelector(`[data-tour="${id}"]`)

afterEach(() => {
  authMock.current = authMock.anon
  nav.pathname = '/pt-BR'
})

describe('âncoras do tour no header', () => {
  it('logado na home: busca, Criar, Salvos, Cardápio, conta e menu mobile', () => {
    authMock.current = logged
    render(wrap(<SiteHeader />))
    expect(anchor('busca')).not.toBeNull()
    expect(anchor('criar')).toHaveTextContent(ptBR.nav.create)
    expect(anchor('nav-salvos')).toHaveAttribute('href', '/me/saved')
    expect(anchor('nav-cardapio')).toHaveAttribute('href', '/me/meal-plan')
    expect(anchor('conta')).not.toBeNull()
    expect(anchor('menu-mobile')).toHaveAccessibleName(ptBR.nav.abrirMenu)
  })

  it('Visitante: sem as âncoras de links só-logados', () => {
    render(wrap(<SiteHeader />))
    expect(anchor('nav-salvos')).toBeNull()
    expect(anchor('nav-cardapio')).toBeNull()
    expect(anchor('criar')).not.toBeNull()
  })
})

describe('"Como usar" (/guia)', () => {
  it('no rodapé, para qualquer pessoa', () => {
    render(wrap(<SiteFooter />))
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: ptBR.nav.comoUsar })).toHaveAttribute(
      'href',
      '/guia',
    )
  })

  it('no menu da conta', async () => {
    authMock.current = logged
    const user = userEvent.setup()
    render(wrap(<AuthSlot />))
    await user.click(screen.getByRole('button', { name: /Ana/ }))
    expect(await screen.findByRole('menuitem', { name: ptBR.nav.comoUsar })).toHaveAttribute('href', '/guia')
  })
})
