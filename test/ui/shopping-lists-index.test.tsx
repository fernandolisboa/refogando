import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do índice das Listas de compras (`ShoppingListsIndex`, `/me/shopping-lists`, ADR-0035
 * Consequências). `fetch` roteado por URL/método: `GET/POST /api/me/shopping-lists` e
 * `DELETE /api/me/shopping-lists/[id]`. `window.confirm` mockado (apagar confirma antes).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR/me/shopping-lists',
}))

const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

function setSession(state: 'logged-in' | 'anon') {
  authMock.session =
    state === 'logged-in'
      ? { data: { user: { id: 'u1' } }, isPending: false, error: null }
      : { data: null, isPending: false, error: null }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ShoppingListsIndex } from '@/components/shopping-list/shopping-lists-index'

const M = ptBR.listaDeCompras

type ListSummary = { id: string; name: string; itemCount: number }
type FetchResult = { status: number; body: unknown }
type Call = { url: string; method: string; body: unknown }

/** `lists` é MUTÁVEL: o POST empurra a lista nova, então o GET seguinte a vê (fake honesto). */
function mockFetch(lists: ListSummary[], opts: { create?: FetchResult; del?: FetchResult } = {}) {
  const calls: Call[] = []
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body != null ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, method, body })
    let r: FetchResult = { status: 404, body: {} }
    if (url === '/api/me/shopping-lists' && method === 'GET') r = { status: 200, body: { lists: [...lists] } }
    else if (url === '/api/me/shopping-lists' && method === 'POST') {
      r = opts.create ?? { status: 201, body: { list: { id: 'nova', name: body.name } } }
      if (r.status < 300) lists.push({ id: 'nova', name: body.name, itemCount: 0 })
    } else if (url.startsWith('/api/me/shopping-lists/') && method === 'DELETE') r = opts.del ?? { status: 200, body: {} }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderIndex() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ShoppingListsIndex />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  setSession('logged-in')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ShoppingListsIndex (ADR-0035)', () => {
  it('Visitante: convite pra entrar, sem fetch', () => {
    setSession('anon')
    const { impl } = mockFetch([])
    renderIndex()
    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fpt-BR%2Fme%2Fshopping-lists',
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it('lista as Listas com contagem (singular/plural) e link pra cada uma', async () => {
    mockFetch([
      { id: 'l1', name: 'Mercado', itemCount: 1 },
      { id: 'l2', name: 'Feira', itemCount: 7 },
    ])
    renderIndex()
    const mercado = await screen.findByRole('link', { name: /Mercado/ })
    expect(mercado).toHaveAttribute('href', '/me/shopping-lists/l1')
    expect(mercado).toHaveTextContent(M.itemContagem)
    const feira = screen.getByRole('link', { name: /Feira/ })
    expect(feira).toHaveAttribute('href', '/me/shopping-lists/l2')
    expect(feira).toHaveTextContent(M.itensContagem.replace('{n}', '7'))
    expect(screen.queryByText(M.vazioIndice, { exact: false })).not.toBeInTheDocument()
  })

  it('sem Listas: estado vazio com link pro Cardápio', async () => {
    mockFetch([])
    renderIndex()
    expect(await screen.findByText(M.vazioIndice, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.cardapio.titulo })).toHaveAttribute('href', '/me/meal-plan')
  })

  it('criar: POST {name}, limpa o campo e recarrega com a lista nova', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch([])
    renderIndex()
    await screen.findByText(M.vazioIndice, { exact: false })

    const input = screen.getByRole('textbox', { name: M.nomeNovaLista })
    const btn = screen.getByRole('button', { name: M.criarLista })
    expect(btn).toBeDisabled()
    await user.type(input, 'Churrasco')
    await user.click(btn)

    expect(await screen.findByRole('link', { name: /Churrasco/ })).toHaveAttribute('href', '/me/shopping-lists/nova')
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Churrasco' })
    expect(input).toHaveValue('')
  })

  it('criar com nome duplicado: mensagem localizada', async () => {
    const user = userEvent.setup()
    mockFetch([{ id: 'l1', name: 'Mercado', itemCount: 0 }], {
      create: { status: 409, body: { error: 'nome_duplicado' } },
    })
    renderIndex()
    await screen.findByRole('link', { name: /Mercado/ })
    await user.type(screen.getByRole('textbox', { name: M.nomeNovaLista }), 'Mercado')
    await user.click(screen.getByRole('button', { name: M.criarLista }))
    expect(await screen.findByText(M.erroNomeDuplicado)).toHaveAttribute('role', 'alert')
  })

  it('apagar: confirma com o nome, DELETE e some da tela', async () => {
    const user = userEvent.setup()
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const { calls } = mockFetch([
      { id: 'l1', name: 'Mercado', itemCount: 1 },
      { id: 'l2', name: 'Feira', itemCount: 2 },
    ])
    renderIndex()
    await screen.findByRole('link', { name: /Mercado/ })

    await user.click(screen.getByRole('button', { name: M.apagarLista.replace('{nome}', 'Mercado') }))
    expect(confirm).toHaveBeenCalledWith(M.confirmarApagarLista.replace('{nome}', 'Mercado'))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/me/shopping-lists/l1')
    expect(screen.queryByRole('link', { name: /Mercado/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Feira/ })).toBeInTheDocument()
  })

  it('apagar cancelado no confirm: nada acontece', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('confirm', vi.fn(() => false))
    const { calls } = mockFetch([{ id: 'l1', name: 'Mercado', itemCount: 1 }])
    renderIndex()
    await screen.findByRole('link', { name: /Mercado/ })
    await user.click(screen.getByRole('button', { name: M.apagarLista.replace('{nome}', 'Mercado') }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(screen.getByRole('link', { name: /Mercado/ })).toBeInTheDocument()
  })

  it('falha ao carregar: alerta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response))
    renderIndex()
    expect(await screen.findByText(M.erroCarregarListas)).toHaveAttribute('role', 'alert')
  })
})
