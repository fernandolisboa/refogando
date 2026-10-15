import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Tira de subabas da seção atual (ADR-0043), montada no layout logo abaixo do header.
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
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SectionTabs } from '@/components/nav/section-tabs'
import { LAST_TAB_STORAGE_KEY } from '@/domain/nav-sections'

const logged = {
  data: { user: { id: 'u1', name: 'X', email: 'x@y.z', role: 'user', handle: 'x', deletedAt: null } },
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: () => {},
}
const pending = { data: null, error: null, isPending: true, isRefetching: false, refetch: () => {} }

function renderTabs(pathname: string) {
  nav.pathname = pathname
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SectionTabs />
    </LocaleProvider>,
  )
}

const tabs = () =>
  within(screen.getByRole('navigation'))
    .getAllByRole('link')
    .map((a) => [a.textContent, a.getAttribute('href')])

afterEach(() => {
  authMock.current = authMock.anon
  nav.pathname = '/pt-BR'
  window.localStorage.clear()
})

describe('SectionTabs (ADR-0043)', () => {
  it('Planejar: Cardápio, Listas de compras e Despensa, com a atual marcada', () => {
    authMock.current = logged
    renderTabs('/pt-BR/me/pantry')
    expect(screen.getByRole('navigation')).toHaveAccessibleName(ptBR.nav.planejar)
    expect(tabs()).toEqual([
      [ptBR.nav.cardapio, '/me/meal-plan'],
      [ptBR.listaDeCompras.indiceTitulo, '/me/shopping-lists'],
      [ptBR.nav.despensa, '/me/pantry'],
    ])
    expect(screen.getByRole('link', { name: ptBR.nav.despensa })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: ptBR.nav.cardapio })).not.toHaveAttribute('aria-current')
  })

  it('no detalhe de uma lista, a aba Listas fica marcada como item atual ("true")', () => {
    authMock.current = logged
    renderTabs('/en-US/me/shopping-lists/0b5c')
    expect(screen.getByRole('link', { name: ptBR.listaDeCompras.indiceTitulo })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('Minhas receitas: Criações e Salvos', () => {
    authMock.current = logged
    renderTabs('/pt-BR/me/saved')
    expect(tabs()).toEqual([
      [ptBR.nav.criacoes, '/me/recipes'],
      [ptBR.colecoes.titulo, '/me/saved'],
    ])
  })

  it('Explorar logado: Descobrir, Seguindo e Cozinheiros', () => {
    authMock.current = logged
    renderTabs('/pt-BR/cooks')
    expect(tabs()).toEqual([
      [ptBR.nav.descobrir, '/'],
      [ptBR.nav.seguindo, '/following'],
      [ptBR.nav.cozinheiros, '/cooks'],
    ])
  })

  it('Explorar Visitante: sem Seguindo, nem enquanto a sessão carrega', () => {
    renderTabs('/pt-BR')
    expect(tabs().map(([label]) => label)).toEqual([ptBR.nav.descobrir, ptBR.nav.cozinheiros])
  })

  it('seção pessoal com a sessão carregando: a tira já aparece (sem empurrar a página depois)', () => {
    authMock.current = pending
    renderTabs('/pt-BR/me/meal-plan')
    expect(tabs()).toHaveLength(3)
  })

  it('seção pessoal para o Visitante: sem tira', () => {
    renderTabs('/pt-BR/me/recipes')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it.each(['/pt-BR/recipes/arroz', '/pt-BR/guia', '/pt-BR/me/profile', '/pt-BR/create'])(
    'fora das seções (%s): nada',
    (path) => {
      authMock.current = logged
      renderTabs(path)
      expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    },
  )

  it('lembra a aba das seções pessoais, não a de Explorar', () => {
    authMock.current = logged
    const { unmount } = renderTabs('/pt-BR/me/shopping-lists/0b5c')
    unmount()
    renderTabs('/pt-BR/cooks')
    expect(JSON.parse(window.localStorage.getItem(LAST_TAB_STORAGE_KEY)!)).toEqual({
      planejar: '/me/shopping-lists',
    })
  })
})
