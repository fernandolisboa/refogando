import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link → <a> simples (não há AppRouterContext no jsdom).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// Factory de mock de sessão — shape COMPLETO de useSession (data/error/isPending/
// isRefetching/refetch), reusado por todos os cenários. `refetch` é espião por instância.
type SessionData = { user: { id: string; name?: string; email: string; role?: string } } | null
const fakeSession = (over: Partial<{ data: SessionData; error: unknown; isPending: boolean }> = {}) => ({
  data: null as SessionData,
  error: null as unknown,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
  ...over,
})

// Estado controlável por variável de módulo: cada teste seta o retorno antes de renderizar.
let mockSession = fakeSession()
const signOut = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockSession,
  signOut: (...args: unknown[]) => signOut(...args),
}))

import { LocaleProvider } from '@/i18n/provider'
import { AuthSlot } from '@/components/auth-slot'
import type { Locale } from '@/i18n/locale'

function renderSlot(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AuthSlot />
    </LocaleProvider>,
  )
}

const authed = (over: Partial<{ id: string; name?: string; email: string }> = {}) =>
  fakeSession({ data: { user: { id: 'u1', name: 'Ana', email: 'ana@ex.com', ...over } } })

describe('AuthSlot — estado de sessão na chrome (#55)', () => {
  beforeEach(() => {
    mockSession = fakeSession()
    signOut.mockClear()
  })

  it('anônimo: mostra Entrar com href /sign-in, sem Sair', () => {
    mockSession = fakeSession()
    renderSlot('pt-BR')
    const link = screen.getByRole('link', { name: 'Entrar' })
    expect(link).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByText('Sair')).not.toBeInTheDocument()
  })

  it('autenticado: mostra nome + Sair, sem Entrar', () => {
    mockSession = authed()
    renderSlot('pt-BR')
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
    expect(screen.queryByText('Entrar')).not.toBeInTheDocument()
  })

  it('autenticado: o nome é um link para /me/profile (#124)', () => {
    mockSession = authed()
    renderSlot('pt-BR')
    const link = screen.getByRole('link', { name: 'Ana' })
    expect(link).toHaveAttribute('href', '/me/profile')
  })

  it('autenticado sem nome: cai pro email', () => {
    mockSession = authed({ name: undefined })
    renderSlot('pt-BR')
    expect(screen.getByText('ana@ex.com')).toBeInTheDocument()
  })

  it('clicar Sair chama signOut e refetch, depois reflete anônimo', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    const { rerender } = renderSlot('pt-BR')

    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(mockSession.refetch).toHaveBeenCalledTimes(1)

    // Sessão resolveu pra anônima; a chrome reflete "Entrar" de volta.
    mockSession = fakeSession()
    rerender(
      <LocaleProvider initialLocale="pt-BR">
        <AuthSlot />
      </LocaleProvider>,
    )
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.queryByText('Sair')).not.toBeInTheDocument()
  })

  it('isPending: espaçador com dimensão (aria-hidden), sem piscar Entrar/Sair', () => {
    mockSession = fakeSession({ isPending: true })
    const { container } = renderSlot('pt-BR')
    // Espaçador puramente visual: fora da árvore de a11y (aria-hidden), só reserva espaço.
    const spacer = container.querySelector('[aria-hidden="true"]')
    expect(spacer).toBeInTheDocument()
    expect(spacer?.className).toMatch(/min-w-/)
    expect(spacer?.className).toMatch(/h-8/)
    expect(screen.queryByText('Entrar')).not.toBeInTheDocument()
    expect(screen.queryByText('Sair')).not.toBeInTheDocument()
  })

  it('error de sessão COM sessão presente: fail-open pra anônimo (não trava a chrome)', () => {
    // Isola o ramo `error ||`: sessão presente (stale) MAIS erro de get-session. Se o guard
    // regredisse pra `if (!session)`, renderizaria autenticado (Ana/Sair) — então este caso
    // trava a invariante de fail-open que `data:null` sozinho não exercita.
    mockSession = fakeSession({ ...authed(), error: new Error('get-session falhou') })
    renderSlot('pt-BR')
    expect(screen.getByRole('link', { name: 'Entrar' })).toBeInTheDocument()
    expect(screen.queryByText('Ana')).not.toBeInTheDocument()
    expect(screen.queryByText('Sair')).not.toBeInTheDocument()
  })

  it('en-US: rótulos em inglês (anônimo e autenticado)', () => {
    mockSession = fakeSession()
    const { unmount } = renderSlot('en-US')
    expect(screen.getByText('Sign in')).toBeInTheDocument()
    unmount()

    mockSession = authed()
    renderSlot('en-US')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
