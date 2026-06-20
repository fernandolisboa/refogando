import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Navegação por seção do Console (#125) — substitui o render-por-papel do antigo
 * `AdminConsole`. A Governança (Config, Papéis) some para o Curador (AC5 — escondido, não
 * desabilitado); a Curadoria aparece para curador E admin. É só afordância: o gate de
 * verdade é por rota (`admin-section-access`/`admin-routes-gate`). Seam jsdom (#54).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const pathMock = vi.hoisted(() => ({ current: '/admin/config' }))
vi.mock('next/navigation', () => ({
  usePathname: () => pathMock.current,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SectionNav } from '@/components/admin/section-nav'

const A = ptBR.admin

function renderNav(role: 'admin' | 'curador', path = '/admin/config') {
  pathMock.current = path
  render(
    <LocaleProvider initialLocale="pt-BR">
      <SectionNav role={role} />
    </LocaleProvider>,
  )
  return screen.getByRole('navigation', { name: A.navAria })
}

describe('SectionNav — links por papel (#125)', () => {
  it('admin vê as 5 seções (Governança + Curadoria)', () => {
    const nav = renderNav('admin')
    for (const label of [A.navConfig, A.navPapeis, A.navModeracao, A.navTraducoes, A.navCatalogo]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('curador NÃO vê a Governança (Config, Papéis); vê só a Curadoria', () => {
    const nav = renderNav('curador', '/admin/moderation')
    expect(within(nav).queryByRole('link', { name: A.navConfig })).toBeNull()
    expect(within(nav).queryByRole('link', { name: A.navPapeis })).toBeNull()
    for (const label of [A.navModeracao, A.navTraducoes, A.navCatalogo]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('marca a rota ativa com aria-current="page"', () => {
    const nav = renderNav('admin', '/admin/users')
    expect(within(nav).getByRole('link', { name: A.navPapeis })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: A.navConfig })).not.toHaveAttribute('aria-current')
  })

  it('links apontam para as rotas aninhadas corretas', () => {
    const nav = renderNav('admin')
    expect(within(nav).getByRole('link', { name: A.navConfig })).toHaveAttribute(
      'href',
      '/admin/config',
    )
    expect(within(nav).getByRole('link', { name: A.navPapeis })).toHaveAttribute(
      'href',
      '/admin/users',
    )
    expect(within(nav).getByRole('link', { name: A.navModeracao })).toHaveAttribute(
      'href',
      '/admin/moderation',
    )
    expect(within(nav).getByRole('link', { name: A.navTraducoes })).toHaveAttribute(
      'href',
      '/admin/translations',
    )
    expect(within(nav).getByRole('link', { name: A.navCatalogo })).toHaveAttribute(
      'href',
      '/admin/catalog',
    )
  })
})
