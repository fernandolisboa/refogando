import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * "Despensa" na nav (ADR-0038) — a Despensa (`/me/pantry`) ganhou link na
 * chrome, só pra quem está logado, logo depois de "Despensa", no desktop E no drawer mobile.
 * Espelha `site-header-salvos.test.tsx`.
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

const DESPENSA = ptBR.nav.despensa

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

function desktopNav() {
  return screen.getAllByRole('navigation')[0]
}

afterEach(() => {
  authMock.current = authMock.anon
  nav.pathname = '/pt-BR'
})

describe('Header — "Despensa" na chrome (ADR-0038)', () => {
  it('logado: a nav do desktop linka "Despensa" para /me/pantry, logo depois de "Cardápio"', () => {
    authMock.current = logged
    renderHeader()
    const labels = within(desktopNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels.indexOf(DESPENSA)).toBe(labels.indexOf(ptBR.nav.cardapio) + 1)
    expect(within(desktopNav()).getByRole('link', { name: DESPENSA })).toHaveAttribute('href', '/me/pantry')
  })

  it('logado: em /me/pantry o link fica ativo (aria-current=page)', () => {
    authMock.current = logged
    nav.pathname = '/pt-BR/me/pantry'
    renderHeader()
    expect(within(desktopNav()).getByRole('link', { name: DESPENSA })).toHaveAttribute('aria-current', 'page')
  })

  it('logado: o drawer mobile também tem "Despensa" → /me/pantry', async () => {
    authMock.current = logged
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ptBR.nav.abrirMenu }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: DESPENSA })).toHaveAttribute('href', '/me/pantry')
  })

  it('Visitante: nenhum "Despensa" no header nem no drawer', async () => {
    const user = userEvent.setup()
    renderHeader()
    expect(screen.queryByRole('link', { name: DESPENSA })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ptBR.nav.abrirMenu }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('link', { name: DESPENSA })).not.toBeInTheDocument()
  })
})
