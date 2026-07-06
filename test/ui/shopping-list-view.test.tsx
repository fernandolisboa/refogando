import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom da "Lista de compras" — edição à mão (#528, ADR-0032 dec.5): item avulso, editar
 * quantidade, remover linha. Espelha `my-recipes-list.test.tsx` (fetch mockado no SHAPE REAL das
 * rotas; `useSession`/`next/link`/`next/navigation` mockados; LocaleProvider real).
 *
 * `fetch` é roteado por (método, URL) — a tela faz VÁRIAS chamadas (GET listas, POST criar lista
 * default, GET/POST itens, PATCH/DELETE item), então o mock precisa distinguir cada uma.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/me/shopping-lists',
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { Locale } from '@/i18n/locale'
import { ShoppingListView } from '@/components/recipe/shopping-list-view'

const M = ptBR.listaCompras

function authed(): SessionState {
  return { data: { user: { id: 'u-1' } }, error: null, isPending: false }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false }
}

type Item = {
  id: string
  nome: string
  quantidade: string | null
  unidade: string | null
  ingredientId: string | null
  sourceRecipeId: string | null
}
function item(over: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    nome: 'Farinha',
    quantidade: '200.000',
    unidade: 'g',
    ingredientId: null,
    sourceRecipeId: null,
    ...over,
  }
}

/** Roteador de fetch: um handler por (método, padrão de URL). Lança se a URL não bater com nada
 * — força o teste a mockar exatamente o que a tela chama (nunca silenciosamente undefined). */
function mockFetch(handlers: {
  lists?: () => { id: string; name: string }[]
  createList?: () => Response | { status: number; body: unknown }
  items?: (listId: string) => Item[]
  addItem?: (listId: string, body: unknown) => { status: number; body: unknown }
  editItem?: (listId: string, itemId: string, body: unknown) => { status: number; body: unknown }
  removeItem?: (listId: string, itemId: string) => { status: number; body: unknown }
}) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (method === 'GET' && url.includes('/api/me/shopping-lists') && !url.includes('/items')) {
      return { ok: true, status: 200, json: async () => ({ lists: handlers.lists?.() ?? [] }) } as Response
    }
    if (method === 'POST' && url.endsWith('/api/me/shopping-lists')) {
      const res = handlers.createList?.() ?? { status: 200, body: { list: { id: 'list-1', name: 'Lista de compras' } } }
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    const itemsMatch = url.match(/\/api\/me\/shopping-lists\/([^/]+)\/items$/)
    if (method === 'GET' && itemsMatch) {
      return { ok: true, status: 200, json: async () => ({ items: handlers.items?.(itemsMatch[1]) ?? [] }) } as Response
    }
    if (method === 'POST' && itemsMatch) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const res = handlers.addItem?.(itemsMatch[1], body) ?? { status: 200, body: { ok: true } }
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    const itemMatch = url.match(/\/api\/me\/shopping-lists\/([^/]+)\/items\/([^/]+)$/)
    if (method === 'PATCH' && itemMatch) {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      const res = handlers.editItem?.(itemMatch[1], itemMatch[2], body) ?? { status: 200, body: { ok: true } }
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    if (method === 'DELETE' && itemMatch) {
      const res = handlers.removeItem?.(itemMatch[1], itemMatch[2]) ?? { status: 200, body: { ok: true } }
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderView(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ShoppingListView />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ShoppingListView (#528)', () => {
  it('Visitante: convite de entrar, sem fetch', () => {
    sessionState = guest()
    const fetchMock = mockFetch({})
    renderView()
    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fme%2Fshopping-lists',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lista existente: exibe as linhas em prosa (Direção B — nome sem medida re-embutida)', async () => {
    sessionState = authed()
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [item({ nome: 'Farinha', quantidade: '300.000', unidade: 'g' })],
    })
    renderView()
    expect(await screen.findByText('300 g de Farinha')).toBeInTheDocument()
  })

  it('sem nenhuma lista ainda: cria a lista-padrão (dec.1) e carrega os itens dela', async () => {
    sessionState = authed()
    const fetchMock = mockFetch({
      lists: () => [],
      createList: () => ({ status: 200, body: { list: { id: 'list-novo', name: 'Lista de compras' } } }),
      items: () => [item({ id: 'i-novo', nome: 'Sal', quantidade: null, unidade: 'a_gosto' })],
    })
    renderView()
    expect(await screen.findByText('Sal a gosto')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/shopping-lists',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('lista vazia: mensagem de vazio', async () => {
    sessionState = authed()
    mockFetch({ lists: () => [{ id: 'list-1', name: 'Lista de compras' }], items: () => [] })
    renderView()
    expect(await screen.findByText(M.vazio)).toBeInTheDocument()
  })

  it('adicionar item avulso: nome obrigatório, quantidade/unidade opcionais — POST com o corpo certo', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    let addedBody: unknown = null
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [],
      addItem: (listId, body) => {
        addedBody = body
        return { status: 200, body: { ok: true } }
      },
    })
    renderView()
    await screen.findByText(M.vazio)

    await user.type(screen.getByPlaceholderText(M.nomeItemPlaceholder), 'Guardanapos')
    await user.click(screen.getByRole('button', { name: M.adicionar }))

    await waitFor(() =>
      expect(addedBody).toMatchObject({ nome: 'Guardanapos', quantidade: null, unidade: null }),
    )
  })

  it('adicionar item avulso com quantidade/unidade: converte vírgula pt-BR pra ponto no POST', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    let addedBody: unknown = null
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [],
      addItem: (listId, body) => {
        addedBody = body
        return { status: 200, body: { ok: true } }
      },
    })
    renderView()
    await screen.findByText(M.vazio)

    await user.type(screen.getByPlaceholderText(M.nomeItemPlaceholder), 'Açúcar')
    await user.type(screen.getByPlaceholderText(M.quantidadePlaceholder), '2,5')
    await user.selectOptions(screen.getByDisplayValue(M.unidadeNenhuma), 'kg')
    await user.click(screen.getByRole('button', { name: M.adicionar }))

    await waitFor(() => expect(addedBody).toMatchObject({ nome: 'Açúcar', quantidade: '2.5', unidade: 'kg' }))
  })

  it('erro do servidor no adicionar (nome_invalido) mostra a mensagem localizada', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [],
      addItem: () => ({ status: 400, body: { error: 'nome_invalido' } }),
    })
    renderView()
    await screen.findByText(M.vazio)

    await user.type(screen.getByPlaceholderText(M.nomeItemPlaceholder), 'x')
    await user.click(screen.getByRole('button', { name: M.adicionar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroNomeInvalido)
  })

  it('editar a quantidade de uma linha: abre o form inline, salva com PATCH', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    let patched: unknown = null
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [item({ id: 'i-1', nome: 'Farinha', quantidade: '200.000', unidade: 'g' })],
      editItem: (listId, itemId, body) => {
        patched = { listId, itemId, body }
        return { status: 200, body: { ok: true } }
      },
    })
    renderView()
    await screen.findByText('200 g de Farinha')

    await user.click(screen.getByRole('button', { name: `${M.editarQuantidade}: Farinha` }))
    // O form de adicionar item avulso também tem um campo "Quantidade" visível ao mesmo tempo —
    // desambigua pelo VALOR pré-preenchido (`formatQuantityInput('200.000') === '200'`), único
    // nesse momento (o campo do form de adicionar está vazio).
    const input = screen.getByDisplayValue('200')
    await user.clear(input)
    await user.type(input, '350')
    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() =>
      expect(patched).toMatchObject({ listId: 'list-1', itemId: 'i-1', body: { quantidade: '350' } }),
    )
  })

  it('cancelar a edição não chama PATCH', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    const editItem = vi.fn(() => ({ status: 200, body: { ok: true } }))
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [item({ id: 'i-1', nome: 'Farinha', quantidade: '200.000', unidade: 'g' })],
      editItem,
    })
    renderView()
    await screen.findByText('200 g de Farinha')

    await user.click(screen.getByRole('button', { name: `${M.editarQuantidade}: Farinha` }))
    await user.click(screen.getByRole('button', { name: M.cancelar }))

    expect(editItem).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: `${M.editarQuantidade}: Farinha` })).toBeInTheDocument()
  })

  it('remover uma linha: confirma e chama DELETE', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let removed: unknown = null
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [item({ id: 'i-1', nome: 'Farinha', quantidade: '200.000', unidade: 'g' })],
      removeItem: (listId, itemId) => {
        removed = { listId, itemId }
        return { status: 200, body: { ok: true } }
      },
    })
    renderView()
    await screen.findByText('200 g de Farinha')

    await user.click(screen.getByRole('button', { name: `${M.remover}: Farinha` }))

    await waitFor(() => expect(removed).toEqual({ listId: 'list-1', itemId: 'i-1' }))
  })

  it('remover sem confirmar: NÃO chama DELETE', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const removeItem = vi.fn(() => ({ status: 200, body: { ok: true } }))
    mockFetch({
      lists: () => [{ id: 'list-1', name: 'Lista de compras' }],
      items: () => [item({ id: 'i-1', nome: 'Farinha', quantidade: '200.000', unidade: 'g' })],
      removeItem,
    })
    renderView()
    await screen.findByText('200 g de Farinha')

    await user.click(screen.getByRole('button', { name: `${M.remover}: Farinha` }))
    expect(removeItem).not.toHaveBeenCalled()
  })

  it('erro ao carregar (500): alerta de erro', async () => {
    sessionState = authed()
    const impl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response)
    vi.stubGlobal('fetch', impl)
    renderView()
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroCarregar)
  })
})
