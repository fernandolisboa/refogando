import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link precisa do AppRouterContext em runtime; no jsdom não há router montado.
// Mockamos pra um <a> simples — o que importa aqui é a chrome acompanhar o locale,
// não a navegação do Next.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// O AuthSlot agora chama useSession; sem mock o hook tentaria buscar /api/auth/get-session
// (quebraria no jsdom). Mock com o shape COMPLETO de useSession (Visitante: data=null), pra
// as asserções de "Entrar"/"Sign in" do header seguirem válidas e o contrato tipado bater.
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }),
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { SiteHeader } from '@/components/site-header'

/**
 * Seam de teste de FRONTEND (issue #54) — prova, acima da seam de servidor e sem
 * browser/Postgres, que: (1) a chrome renderiza no locale inicial; (2) trocar o seletor
 * de idioma faz TODA a chrome acompanhar (#4.AC1), agora dentro do shell de design.
 */
describe('SiteHeader — troca de locale cascateia na chrome', () => {
  it('renderiza pt-BR e segue pro en-US ao trocar o seletor', async () => {
    const user = userEvent.setup()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <SiteHeader />
      </LocaleProvider>,
    )

    // Estado inicial: chrome em pt-BR.
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Início')).toBeInTheDocument()
    expect(within(nav).getByText('Receitas')).toBeInTheDocument()
    expect(screen.getByText('Entrar')).toBeInTheDocument()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('pt-BR')

    // Troca o idioma no seletor.
    await user.selectOptions(select, 'en-US')

    // A chrome inteira acompanha — nav, slot de auth e o valor do seletor.
    expect(select.value).toBe('en-US')
    expect(within(nav).getByText('Home')).toBeInTheDocument()
    expect(within(nav).getByText('Recipes')).toBeInTheDocument()
    expect(screen.getByText('Sign in')).toBeInTheDocument()
    expect(within(nav).queryByText('Início')).not.toBeInTheDocument()
  })
})
