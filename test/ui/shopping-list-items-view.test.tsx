import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom da vista da Lista de compras — check-off PERSISTENTE (issue #529, ADR-0032 dec.6).
 * `fetch` mockado no shape REAL das rotas (`GET/DELETE .../items`, `DELETE .../items/checked`,
 * `PATCH .../items/[itemId]`). `useSession`/`next/link`/`next/navigation` mockados (sem AppRouter/
 * Better Auth no jsdom). `window.confirm` mockado (as duas ações em massa confirmam antes).
 * Modelo: my-recipes-list.test.tsx.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/me/shopping-lists/list-1',
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ShoppingListItemsView } from '@/components/shopping-list/shopping-list-items-view'

const M = ptBR.listaDeCompras

function authed(): SessionState {
  return { data: { user: { id: 'u-1' } }, error: null, isPending: false }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false }
}

type Item = { id: string; nome: string; quantidade: string | null; unidade: string | null; checkedAt: string | null }

function itemsResponse(items: Item[], name = 'Lista'): { list: { id: string; name: string }; items: Item[] } {
  return { list: { id: 'list-1', name }, items }
}

/** Mock de `fetch` roteado por método+URL, espelha `mockRecipes` de my-recipes-list.test.tsx. */
function mockFetch(handlers: {
  get?: () => { list: { id: string; name: string }; items: Item[] }
  patch?: (url: string, body: { checked: boolean }) => { checkedAt: string | null }
  deleteChecked?: () => { removed: number }
  deleteAll?: () => { removed: number }
}) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    // Os handlers rodam EAGER (não dentro de `json: async () => …`): o componente às vezes só
    // olha `res.ok` sem consumir o corpo (ex. handleRemoveChecked/handleClearList não leem
    // `removed`) — se o handler só rodasse ao chamar `.json()`, o spy nunca seria marcado.
    if (method === 'GET' && url.includes('/items') && handlers.get) {
      const result = handlers.get()
      return { ok: true, status: 200, json: async () => result } as Response
    }
    if (method === 'PATCH' && handlers.patch) {
      const body = JSON.parse(String(init?.body)) as { checked: boolean }
      const result = handlers.patch(url, body)
      return { ok: true, status: 200, json: async () => result } as Response
    }
    if (method === 'DELETE' && url.endsWith('/checked') && handlers.deleteChecked) {
      const result = handlers.deleteChecked()
      return { ok: true, status: 200, json: async () => result } as Response
    }
    if (method === 'DELETE' && !url.endsWith('/checked') && handlers.deleteAll) {
      const result = handlers.deleteAll()
      return { ok: true, status: 200, json: async () => result } as Response
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ShoppingListItemsView (#529 — check-off persistente)', () => {
  it('renderiza os itens; o marcado aparece riscado (checked_at não-nulo)', async () => {
    mockFetch({
      get: () =>
        itemsResponse([
          { id: 'i1', nome: 'Arroz', quantidade: '1.000', unidade: 'kg', checkedAt: null },
          { id: 'i2', nome: 'Feijão', quantidade: null, unidade: null, checkedAt: '2026-07-05T10:00:00.000Z' },
        ]),
    })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByText(/Arroz/)).toBeInTheDocument())
    expect(screen.getByText('Feijão')).toHaveClass('line-through')

    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).not.toBeChecked()
    expect(checkboxes[1]).toBeChecked()
  })

  it('marcar um item chama PATCH {checked:true} e reflete marcado', async () => {
    const patch = vi.fn(() => ({ checkedAt: '2026-07-05T12:00:00.000Z' }))
    mockFetch({
      get: () => itemsResponse([{ id: 'i1', nome: 'Sal', quantidade: null, unidade: 'a_gosto', checkedAt: null }]),
      patch,
    })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByRole('checkbox')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox'))

    await waitFor(() => expect(patch).toHaveBeenCalledWith(expect.stringContaining('/items/i1'), { checked: true }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
  })

  it('"Remover marcados" fica desabilitado sem nenhum item marcado', async () => {
    mockFetch({
      get: () => itemsResponse([{ id: 'i1', nome: 'Arroz', quantidade: null, unidade: null, checkedAt: null }]),
    })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByText(M.removerMarcados)).toBeInTheDocument())
    expect(screen.getByText(M.removerMarcados).closest('button')).toBeDisabled()
  })

  it('"Remover marcados" confirma e chama DELETE .../items/checked; a lista recarrega', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    let callCount = 0
    const deleteChecked = vi.fn(() => ({ removed: 1 }))
    mockFetch({
      get: () => {
        callCount++
        return callCount === 1
          ? itemsResponse([{ id: 'i1', nome: 'Marcado', quantidade: null, unidade: null, checkedAt: '2026-07-05T10:00:00.000Z' }])
          : itemsResponse([])
      },
      deleteChecked,
    })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByText(M.removerMarcados)).not.toBeDisabled())
    fireEvent.click(screen.getByText(M.removerMarcados))

    await waitFor(() => expect(deleteChecked).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
  })

  it('"Limpar lista" confirma e chama DELETE .../items (sem /checked); esvazia', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    let callCount = 0
    const deleteAll = vi.fn(() => ({ removed: 2 }))
    mockFetch({
      get: () => {
        callCount++
        return callCount === 1
          ? itemsResponse([
              { id: 'i1', nome: 'A', quantidade: null, unidade: null, checkedAt: null },
              { id: 'i2', nome: 'B', quantidade: null, unidade: null, checkedAt: '2026-07-05T10:00:00.000Z' },
            ])
          : itemsResponse([])
      },
      deleteAll,
    })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByText(M.limparLista)).not.toBeDisabled())
    fireEvent.click(screen.getByText(M.limparLista))

    await waitFor(() => expect(deleteAll).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
  })

  it('NÃO chama DELETE quando o dono cancela a confirmação (nada é apagado sem gesto explícito)', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const deleteAll = vi.fn(() => ({ removed: 0 }))
    mockFetch({
      get: () => itemsResponse([{ id: 'i1', nome: 'A', quantidade: null, unidade: null, checkedAt: null }]),
      deleteAll,
    })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByText(M.limparLista)).not.toBeDisabled())
    fireEvent.click(screen.getByText(M.limparLista))

    expect(deleteAll).not.toHaveBeenCalled()
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('estado vazio: "Sua lista está vazia." e ambos os botões desabilitados', async () => {
    mockFetch({ get: () => itemsResponse([]) })
    sessionState = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
    expect(screen.getByText(M.removerMarcados).closest('button')).toBeDisabled()
    expect(screen.getByText(M.limparLista).closest('button')).toBeDisabled()
  })

  it('guest (sem sessão): convite de entrar, sem fetch de itens', async () => {
    const impl = mockFetch({})
    sessionState = guest()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <ShoppingListItemsView listId="list-1" />
      </LocaleProvider>,
    )

    expect(await screen.findByText(M.precisaEntrar)).toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
  })
})

// ── Edição à mão (fatia C, #528, dec.5) ──────────────────────────────────────────

/**
 * Mock de `fetch` mais completo pras ações de edição à mão: GET (itens, pode mudar após mutação),
 * POST (item avulso), PATCH `{quantidade}` (editar), DELETE `.../items/[itemId]` (remover linha).
 * Captura os corpos pra assertar o payload REAL enviado ao servidor.
 */
function mockFetchEdit(handlers: {
  get?: () => { list: { id: string; name: string }; items: Item[] }
  post?: (body: unknown) => { status: number; body: unknown }
  patchQuantidade?: (url: string, body: { quantidade: unknown }) => { status: number; body: unknown }
  deleteItem?: (url: string) => { status: number; body: unknown }
}) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (method === 'GET' && url.includes('/items') && handlers.get) {
      const result = handlers.get()
      return { ok: true, status: 200, json: async () => result } as Response
    }
    if (method === 'POST' && url.endsWith('/items') && handlers.post) {
      const res = handlers.post(init?.body ? JSON.parse(String(init.body)) : {})
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    if (method === 'PATCH' && handlers.patchQuantidade) {
      const res = handlers.patchQuantidade(url, JSON.parse(String(init?.body)) as { quantidade: unknown })
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    // DELETE de UMA linha: .../items/<uuid> (NÃO termina em /checked e NÃO é o .../items exato).
    if (method === 'DELETE' && /\/items\/[^/]+$/.test(url) && !url.endsWith('/checked') && handlers.deleteItem) {
      const res = handlers.deleteItem(url)
      return { ok: res.status < 300, status: res.status, json: async () => res.body } as Response
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderView() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ShoppingListItemsView listId="list-1" />
    </LocaleProvider>,
  )
}

describe('ShoppingListItemsView (#528 — edição à mão)', () => {
  it('adicionar item avulso: nome obrigatório, quantidade/unidade opcionais — POST com corpo certo', async () => {
    let posted: unknown = null
    mockFetchEdit({
      get: () => itemsResponse([]),
      post: (body) => {
        posted = body
        return { status: 200, body: { ok: true } }
      },
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(M.nomeItemPlaceholder), { target: { value: 'Guardanapos' } })
    fireEvent.click(screen.getByRole('button', { name: M.adicionarBotao }))

    await waitFor(() =>
      expect(posted).toMatchObject({ nome: 'Guardanapos', quantidade: null, unidade: null }),
    )
  })

  it('adicionar avulso com quantidade/unidade: converte vírgula pt-BR pra ponto no POST', async () => {
    let posted: unknown = null
    mockFetchEdit({
      get: () => itemsResponse([]),
      post: (body) => {
        posted = body
        return { status: 200, body: { ok: true } }
      },
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(M.nomeItemPlaceholder), { target: { value: 'Açúcar' } })
    fireEvent.change(screen.getByPlaceholderText(M.quantidadePlaceholder), { target: { value: '2,5' } })
    fireEvent.change(screen.getByDisplayValue(M.unidadeNenhuma), { target: { value: 'kg' } })
    fireEvent.click(screen.getByRole('button', { name: M.adicionarBotao }))

    await waitFor(() => expect(posted).toMatchObject({ nome: 'Açúcar', quantidade: '2.5', unidade: 'kg' }))
  })

  it('erro do servidor no adicionar (nome_invalido) mostra a mensagem localizada do ITEM', async () => {
    mockFetchEdit({
      get: () => itemsResponse([]),
      post: () => ({ status: 400, body: { error: 'nome_invalido' } }),
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(M.nomeItemPlaceholder), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: M.adicionarBotao }))

    expect(await screen.findByText(M.erroItemNomeInvalido)).toBeInTheDocument()
  })

  it('editar a quantidade de uma linha: abre o form inline e salva com PATCH {quantidade}', async () => {
    let patched: unknown = null
    let calls = 0
    mockFetchEdit({
      get: () => {
        calls++
        return itemsResponse([
          { id: 'i1', nome: 'Farinha', quantidade: calls <= 1 ? '200.000' : '350.000', unidade: 'g', checkedAt: null },
        ])
      },
      patchQuantidade: (_url, body) => {
        patched = body
        return { status: 200, body: { ok: true } }
      },
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText('200 g de Farinha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${M.editarQuantidade}: Farinha` }))
    // Desambigua do campo "Quantidade" do form de item avulso (vazio) pelo valor pré-preenchido.
    fireEvent.change(screen.getByDisplayValue('200'), { target: { value: '350' } })
    fireEvent.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(patched).toEqual({ quantidade: '350' }))
    await waitFor(() => expect(screen.getByText('350 g de Farinha')).toBeInTheDocument())
  })

  it('editar → quantidade vazia envia null (limpa a quantidade)', async () => {
    let patched: unknown = null
    mockFetchEdit({
      get: () => itemsResponse([{ id: 'i1', nome: 'Sal', quantidade: '5.000', unidade: 'g', checkedAt: null }]),
      patchQuantidade: (_url, body) => {
        patched = body
        return { status: 200, body: { ok: true } }
      },
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText('5 g de Sal')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${M.editarQuantidade}: Sal` }))
    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(patched).toEqual({ quantidade: null }))
  })

  it('cancelar a edição não chama PATCH', async () => {
    const patchQuantidade = vi.fn(() => ({ status: 200, body: { ok: true } }))
    mockFetchEdit({
      get: () => itemsResponse([{ id: 'i1', nome: 'Farinha', quantidade: '200.000', unidade: 'g', checkedAt: null }]),
      patchQuantidade,
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText('200 g de Farinha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${M.editarQuantidade}: Farinha` }))
    fireEvent.click(screen.getByRole('button', { name: M.cancelar }))

    expect(patchQuantidade).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: `${M.editarQuantidade}: Farinha` })).toBeInTheDocument()
  })

  it('remover uma linha: confirma e chama DELETE .../items/[itemId]', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    let deletedUrl: string | null = null
    let calls = 0
    mockFetchEdit({
      get: () => {
        calls++
        return calls <= 1
          ? itemsResponse([{ id: 'i1', nome: 'Farinha', quantidade: '200.000', unidade: 'g', checkedAt: null }])
          : itemsResponse([])
      },
      deleteItem: (url) => {
        deletedUrl = url
        return { status: 200, body: { ok: true } }
      },
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText('200 g de Farinha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${M.remover}: Farinha` }))

    await waitFor(() => expect(deletedUrl).toContain('/items/i1'))
    await waitFor(() => expect(screen.getByText(M.vazia)).toBeInTheDocument())
  })

  it('remover sem confirmar: NÃO chama DELETE', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false))
    const deleteItem = vi.fn(() => ({ status: 200, body: { ok: true } }))
    mockFetchEdit({
      get: () => itemsResponse([{ id: 'i1', nome: 'Farinha', quantidade: '200.000', unidade: 'g', checkedAt: null }]),
      deleteItem,
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText('200 g de Farinha')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: `${M.remover}: Farinha` }))

    expect(deleteItem).not.toHaveBeenCalled()
  })

  it('check-off (D) E edição (C) coexistem: a mesma linha tem checkbox + editar + remover', async () => {
    mockFetchEdit({
      get: () => itemsResponse([{ id: 'i1', nome: 'Arroz', quantidade: '1.000', unidade: 'kg', checkedAt: null }]),
    })
    sessionState = authed()
    renderView()

    await waitFor(() => expect(screen.getByText('1 kg de Arroz')).toBeInTheDocument())
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${M.editarQuantidade}: Arroz` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${M.remover}: Arroz` })).toBeInTheDocument()
  })
})
