import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom da Despensa (`PantryView`, `/me/pantry`, ADR-0038). `fetch` roteado por URL/método: a
 * Despensa (`GET/POST/DELETE /api/me/pantry`, `DELETE /api/me/pantry/[id]`), os resultados
 * (`GET /api/me/pantry/matches`) e o "pôr o que falta na lista" (`POST /api/me/pantry/missing-to-list`).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR/me/pantry',
}))

const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { PantryView } from '@/components/pantry/pantry-view'

const M = ptBR.despensa

type Item = { id: string; nome: string }
type Match = {
  id: string
  name: string
  slug?: string
  total: number
  covered: number
  missing: string[]
}
type Call = { url: string; method: string; body: unknown }

function mockFetch(state: { items: Item[]; matches: Match[]; missingStatus?: number }) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body != null ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    let status = 404
    let payload: unknown = {}
    if (url === '/api/me/pantry' && method === 'GET') {
      status = 200
      payload = { items: [...state.items] }
    } else if (url === '/api/me/pantry' && method === 'POST') {
      status = 200
      const names = String(body.names)
        .split(',')
        .map((s) => s.trim())
      for (const n of names) state.items.push({ id: `id-${n}`, nome: n })
      payload = {
        ok: true,
        added: names.map((n) => ({ id: `id-${n}`, nome: n })),
        existing: 0,
      }
    } else if (url.startsWith('/api/me/pantry/') && method === 'DELETE') {
      status = 200
      state.items = state.items.filter((i) => !url.endsWith(i.id))
    } else if (url.includes('/api/me/pantry/matches')) {
      status = 200
      payload = { matches: state.matches }
    } else if (url.startsWith('/api/me/pantry/missing-to-list') && method === 'POST' && state.missingStatus) {
      status = state.missingStatus
      payload = { error: 'nada_faltando' }
    } else if (url.startsWith('/api/me/pantry/missing-to-list') && method === 'POST') {
      status = 200
      payload = {
        ok: true,
        listId: 'l1',
        listName: 'Lista de compras',
        addedLines: 2,
      }
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { calls }
}

function renderView() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <PantryView />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  authMock.session = {
    data: { user: { id: 'u1' } },
    isPending: false,
    error: null,
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PantryView', () => {
  it('Visitante: convite para entrar, sem fetch', () => {
    authMock.session = { data: null, isPending: false, error: null }
    const { calls } = mockFetch({ items: [], matches: [] })
    renderView()
    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('Despensa vazia: mensagem de vazio, atalhos de itens comuns e nenhum resultado', async () => {
    mockFetch({ items: [], matches: [] })
    renderView()
    expect(await screen.findByText(M.vazia)).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: M.sugestaoAdicionar.replace('{nome}', 'ovo'),
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(M.resultadosTitulo)).not.toBeInTheDocument()
  })

  it('mostra os itens e separa os resultados em "Dá pra fazer agora" e "Falta pouco"', async () => {
    mockFetch({
      items: [{ id: 'a', nome: 'ovo' }],
      matches: [
        {
          id: 'r1',
          name: 'Omelete',
          slug: 'omelete',
          total: 2,
          covered: 2,
          missing: [],
        },
        {
          id: 'r2',
          name: 'Bolo',
          total: 4,
          covered: 2,
          missing: ['açúcar', 'fermento'],
        },
      ],
    })
    renderView()
    expect(await screen.findByText(M.prontasTitulo)).toBeInTheDocument()
    expect(screen.getByText(M.quaseProntasTitulo)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Omelete' })).toHaveAttribute('href', '/pt-BR/recipes/omelete')
    expect(screen.getByText(M.falta.replace('{lista}', 'açúcar, fermento'))).toBeInTheDocument()
    // O item já na Despensa some dos atalhos.
    expect(
      screen.queryByRole('button', {
        name: M.sugestaoAdicionar.replace('{nome}', 'ovo'),
      }),
    ).not.toBeInTheDocument()
    // Ponte pra criação com os nomes da Despensa, sem gerar sozinha.
    expect(screen.getByRole('link', { name: M.criarComDespensa })).toHaveAttribute(
      'href',
      `/create?q=${encodeURIComponent('uma receita com ovo')}`,
    )
  })

  it('adicionar manda os nomes e recarrega; desligar os básicos pede basics=0', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      items: [{ id: 'a', nome: 'ovo' }],
      matches: [],
    })
    renderView()
    await screen.findByText(M.semResultados)
    await user.type(screen.getByLabelText(M.adicionarRotulo), 'tomate, queijo')
    await user.click(screen.getByRole('button', { name: M.adicionar }))
    await waitFor(() => expect(screen.getByText('queijo')).toBeInTheDocument())
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      names: 'tomate, queijo',
    })

    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(calls.some((c) => c.url.includes('basics=0'))).toBe(true))
  })

  it('"Pôr o que falta na lista" manda a Receita e os básicos e mostra o link da lista', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      items: [{ id: 'a', nome: 'ovo' }],
      matches: [{ id: 'r2', name: 'Bolo', total: 4, covered: 2, missing: ['açúcar'] }],
    })
    renderView()
    const card = (await screen.findByRole('link', { name: 'Bolo' })).closest('li')!
    await user.click(within(card).getByRole('button', { name: `${M.porNaLista}: Bolo` }))
    expect(await within(card).findByRole('link', { name: M.abrirLista })).toHaveAttribute(
      'href',
      '/me/shopping-lists/l1',
    )
    expect(calls.find((c) => c.url.startsWith('/api/me/pantry/missing-to-list'))?.body).toEqual({
      recipeId: 'r2',
      basics: true,
    })
  })

  it('"Pôr o que falta" com 409 (nada faltando) mostra o aviso neutro e recarrega os resultados', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      items: [{ id: 'a', nome: 'ovo' }],
      matches: [{ id: 'r2', name: 'Bolo', total: 4, covered: 3, missing: ['açúcar'] }],
      missingStatus: 409,
    })
    renderView()
    const card = (await screen.findByRole('link', { name: 'Bolo' })).closest('li')!
    const before = calls.filter((c) => c.url.includes('/api/me/pantry/matches')).length
    await user.click(within(card).getByRole('button', { name: `${M.porNaLista}: Bolo` }))
    expect(await screen.findByText(M.nadaFaltando)).toBeInTheDocument()
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/api/me/pantry/matches')).length).toBeGreaterThan(before),
    )
  })

  it('tirar um item chama o DELETE daquele item', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({
      items: [{ id: 'a', nome: 'ovo' }],
      matches: [],
    })
    renderView()
    await user.click(
      await screen.findByRole('button', {
        name: M.remover.replace('{nome}', 'ovo'),
      }),
    )
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me/pantry/a' && c.method === 'DELETE')).toBe(true))
    expect(await screen.findByText(M.vazia)).toBeInTheDocument()
    // Além do recarregamento otimista (disparado junto com o DELETE), os resultados recarregam de novo
    // depois que o DELETE confirma — senão ficariam contando o item removido.
    const del = calls.findIndex((c) => c.method === 'DELETE')
    await waitFor(() =>
      expect(
        calls.slice(del + 1).filter((c) => c.url.includes('/api/me/pantry/matches')).length,
      ).toBeGreaterThanOrEqual(2),
    )
  })
})
