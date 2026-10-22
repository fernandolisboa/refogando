import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Chrome do Console: barra lateral + cabeçalho da seção ativa (grupo, título, descrição) + gaveta de seções
 * do celular. Seam jsdom (#54): a barra lateral e o gatilho da gaveta estão no DOM juntos (o CSS que
 * alterna `lg:` não roda aqui); a gaveta só monta a segunda `SectionNav` quando abre.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))
const pathMock = vi.hoisted(() => ({ current: '/pt-BR/admin/users' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathMock.current }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ConsoleShell } from '@/components/admin/console-shell'

const A = ptBR.admin

function renderShell(role: 'admin' | 'curador', path: string) {
  pathMock.current = path
  render(
    <LocaleProvider initialLocale="pt-BR">
      <ConsoleShell role={role}>
        <section aria-label="conteúdo">x</section>
      </ConsoleShell>
    </LocaleProvider>,
  )
}

describe('ConsoleShell', () => {
  it('cabeçalho da seção ativa: grupo, título (h1) e descrição; um único <main>', () => {
    renderShell('admin', '/pt-BR/admin/users')
    expect(screen.getByRole('heading', { level: 1, name: A.navUsuarios })).toBeInTheDocument()
    expect(screen.getByText(`${A.titulo} · ${A.grupoPessoas}`)).toBeInTheDocument()
    expect(screen.getByText(A.descUsuarios)).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'conteúdo' }).parentElement).toHaveClass('admin-panels')
  })

  it('mostra o papel de quem está no Console', () => {
    renderShell('curador', '/pt-BR/admin/moderation')
    expect(screen.getByText(A.papelCurador)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: A.navModeracao })).toBeInTheDocument()
  })

  it('celular: o gatilho nomeia a seção atual e abre as seções numa gaveta que fecha ao navegar', async () => {
    renderShell('admin', '/pt-BR/admin/ia')
    const u = userEvent.setup()
    const trigger = screen.getByRole('button', { name: A.abrirSecoes })
    expect(trigger).toHaveTextContent(A.navIa)
    await u.click(trigger)
    const dialog = await screen.findByRole('dialog')
    const nav = within(dialog).getByRole('navigation', { name: A.navAria })
    expect(within(nav).getByRole('link', { name: A.navIa })).toHaveAttribute('aria-current', 'page')
    await u.click(within(nav).getByRole('link', { name: A.navUsuarios }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
