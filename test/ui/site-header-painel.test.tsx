import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Link "Painel" do header (#125) — afordância para o Console, visível só a curador+. Seam
 * de FRONTEND (issue #54), acima da seam de servidor: mockamos `useSession()` com um papel
 * e afirmamos presença/ausência do link. A MATRIZ de gate de verdade (quem ENTRA no /admin)
 * é o teste node (`admin-section-access`/`admin-routes-gate`); aqui só a afordância de UI.
 *
 * Espelha `shell.test.tsx`: next/link → <a>, useSession mockável por teste, default Visitante.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
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

function sessionFor(role: string | null) {
  return {
    data: { user: { id: 'u1', name: 'X', email: 'x@y.z', role, deletedAt: null } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: () => {},
  }
}

function renderHeader() {
  const { container } = render(
    <LocaleProvider initialLocale="pt-BR">
      <SiteHeader />
    </LocaleProvider>,
  )
  // Escopo ao próprio render (um teste renderiza duas vezes) — `screen` veria várias navs.
  return within(container).getByRole('navigation')
}

const PAINEL = ptBR.nav.painel

afterEach(() => {
  authMock.current = authMock.anon
})

describe('Header — link "Painel" só para curador+ (#125)', () => {
  it('curador VÊ o link "Painel" apontando para /admin', () => {
    authMock.current = sessionFor('curador')
    const nav = renderHeader()
    const link = within(nav).getByRole('link', { name: PAINEL })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/admin')
  })

  it('admin VÊ o link "Painel"', () => {
    authMock.current = sessionFor('admin')
    const nav = renderHeader()
    expect(within(nav).getByRole('link', { name: PAINEL })).toBeInTheDocument()
  })

  it('usuario NÃO vê o link "Painel"', () => {
    authMock.current = sessionFor('usuario')
    const nav = renderHeader()
    expect(within(nav).queryByText(PAINEL)).not.toBeInTheDocument()
  })

  it('papel desconhecido/null NÃO vê o link (fail-closed na afordância)', () => {
    authMock.current = sessionFor(null)
    const nav = renderHeader()
    expect(within(nav).queryByText(PAINEL)).not.toBeInTheDocument()
    authMock.current = sessionFor('superusuario')
    const nav2 = renderHeader()
    expect(within(nav2).queryByText(PAINEL)).not.toBeInTheDocument()
  })

  it('anon (Visitante) NÃO vê o link "Painel"', () => {
    authMock.current = authMock.anon
    const nav = renderHeader()
    expect(within(nav).queryByText(PAINEL)).not.toBeInTheDocument()
  })
})
