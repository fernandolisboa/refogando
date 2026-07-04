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

const pathMock = vi.hoisted(() => ({ current: '/admin/ia' }))
vi.mock('next/navigation', () => ({
  usePathname: () => pathMock.current,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SectionNav } from '@/components/admin/section-nav'

const A = ptBR.admin

function renderNav(role: 'admin' | 'curador', path = '/admin/ia') {
  pathMock.current = path
  render(
    <LocaleProvider initialLocale="pt-BR">
      <SectionNav role={role} />
    </LocaleProvider>,
  )
  return screen.getByRole('navigation', { name: A.navAria })
}

describe('SectionNav — links por papel (#125) + grupos rotulados (#268)', () => {
  it('admin vê as 8 seções (Governança: IA, Descoberta, Comparador, Cozinhas, Papéis + Curadoria)', () => {
    const nav = renderNav('admin')
    for (const label of [
      A.navIa,
      A.navDescoberta,
      A.navComparador,
      A.navVocabulario,
      A.navPapeis,
      A.navModeracao,
      A.navTraducoes,
      A.navCatalogo,
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('curador NÃO vê a Governança (IA, Descoberta, Comparador, Cozinhas, Papéis); vê só a Curadoria', () => {
    const nav = renderNav('curador', '/admin/moderation')
    expect(within(nav).queryByRole('link', { name: A.navIa })).toBeNull()
    expect(within(nav).queryByRole('link', { name: A.navDescoberta })).toBeNull() // #134: admin-only
    expect(within(nav).queryByRole('link', { name: A.navComparador })).toBeNull() // #425: admin-only
    expect(within(nav).queryByRole('link', { name: A.navVocabulario })).toBeNull() // #321: admin-only
    expect(within(nav).queryByRole('link', { name: A.navPapeis })).toBeNull()
    for (const label of [A.navModeracao, A.navTraducoes, A.navCatalogo]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('#268: admin vê os grupos rotulados Plataforma e Curadoria (role=group nomeado)', () => {
    const nav = renderNav('admin')
    expect(within(nav).getByRole('group', { name: A.grupoPlataforma })).toBeInTheDocument()
    expect(within(nav).getByRole('group', { name: A.grupoCuradoria })).toBeInTheDocument()
    // O grupo Plataforma contém os links de Governança; o Curadoria, os de Curadoria.
    const plataforma = within(nav).getByRole('group', { name: A.grupoPlataforma })
    expect(within(plataforma).getByRole('link', { name: A.navDescoberta })).toBeInTheDocument()
    const curadoria = within(nav).getByRole('group', { name: A.grupoCuradoria })
    expect(within(curadoria).getByRole('link', { name: A.navCatalogo })).toBeInTheDocument()
  })

  it('#268: curador vê só o grupo Curadoria (Plataforma some — sem itens, sem rótulo órfão)', () => {
    const nav = renderNav('curador', '/admin/moderation')
    expect(within(nav).queryByRole('group', { name: A.grupoPlataforma })).toBeNull()
    expect(within(nav).queryByText(A.grupoPlataforma)).toBeNull()
    expect(within(nav).getByRole('group', { name: A.grupoCuradoria })).toBeInTheDocument()
  })

  it('marca a rota ativa com aria-current="page"', () => {
    const nav = renderNav('admin', '/admin/users')
    expect(within(nav).getByRole('link', { name: A.navPapeis })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).getByRole('link', { name: A.navIa })).not.toHaveAttribute('aria-current')
  })

  it('#162: a tira de abas é ROLÁVEL no mobile (sem quebra de linha)', () => {
    const nav = renderNav('admin')
    // Tira horizontal com rolagem: overflow-x-auto + whitespace-nowrap; SEM flex-wrap
    // (que quebraria as abas em várias linhas no mobile).
    expect(nav.className).toContain('overflow-x-auto')
    expect(nav.className).toContain('whitespace-nowrap')
    expect(nav.className).not.toContain('flex-wrap')
    // A aba ativa preserva o indicador border-b-2.
    const active = within(nav).getByRole('link', { name: A.navIa })
    expect(active.className).toContain('border-b-2')
  })

  it('links apontam para as rotas aninhadas corretas', () => {
    const nav = renderNav('admin')
    expect(within(nav).getByRole('link', { name: A.navIa })).toHaveAttribute(
      'href',
      '/admin/ia',
    )
    expect(within(nav).getByRole('link', { name: A.navDescoberta })).toHaveAttribute('href', '/admin/descoberta')
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
