import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Botão "Criar" do header → abre o drawer "Nova receita" (#191, ADR-0021) POR CIMA da tela atual,
 * SEM navegar para /create. Seam de FRONTEND (issue #54): mockamos next/link + useSession e
 * afirmamos que "Criar" é um BOTÃO (não um link) e que clicá-lo monta o dialog do drawer.
 *
 * Espelha site-header-painel.test.tsx nos mocks (next/link → <a>, useSession mockável).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const authMock = vi.hoisted(() => {
  const authed = {
    data: { user: { id: 'u1', name: 'Ana', email: 'a@b.c', role: 'usuario', deletedAt: null } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: () => {},
  }
  return { authed }
})
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.authed,
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SiteHeader } from '@/components/site-header'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Header — "Criar" abre o drawer (#191)', () => {
  it('"Criar" é um botão (não link) e abre o drawer sem navegar', async () => {
    const user = userEvent.setup()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <SiteHeader />
      </LocaleProvider>,
    )

    // "Criar" é um BOTÃO (não <a href="/create">) — não navega.
    const criar = screen.getByRole('button', { name: ptBR.nav.create })
    expect(criar).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: ptBR.nav.create })).toBeNull()

    // Nenhum drawer montado antes do clique.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(criar)

    // O drawer "Nova receita" abre no método-picker.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(ptBR.criarDrawer.tituloPicker)

    // ESC fecha.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
