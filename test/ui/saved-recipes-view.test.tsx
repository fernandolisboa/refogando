import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeListItem } from '@/domain/recipe-list-read'

/**
 * Teste jsdom da multi-seleção "adicionar à lista" em `SavedRecipesView` (fatia E, issue #530,
 * ADR-0032 dec.7). `fetch` mockado por URL/método no shape REAL das rotas envolvidas:
 * `/api/me/collections` (vazio — foco é "Todos"), `/api/me/saved` (os cards), `/api/me/shopping-lists`
 * (GET pro seletor + POST pra criar inline) e `/api/me/shopping-lists/[id]/items/batch` (o POST em
 * lote). `useSession`/`next/link`/`usePathname` mockados, como `my-recipes-list.test.tsx`.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/me/saved',
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SavedRecipesView } from '@/components/recipe/saved-recipes-view'

const M = ptBR.listaDeCompras

function authed(): SessionState {
  return { data: { user: { id: 'u-1' } }, error: null, isPending: false }
}

function item(over: Partial<RecipeListItem> = {}): RecipeListItem {
  return {
    id: 'r-1',
    name: 'Bolo de fubá',
    origin: 'ai_structured',
    visibility: 'private',
    resultKind: 'success',
    lineageKind: null,
    updatedAt: '2026-06-18T00:00:00.000Z',
    moderationRemovida: false,
    ...over,
  }
}

type ListOption = { id: string; name: string }

/**
 * Roteador de `fetch` por URL (contains) — cobre as 5 rotas que `SavedRecipesView` +
 * `ShoppingListAddBar` chamam. `lists` é um array MUTÁVEL: o POST de criar lista empurra nela,
 * então um GET subsequente veria a nova lista (não usado aqui, mas mantém o fake honesto).
 */
function mockFetch(opts: {
  recipes: RecipeListItem[]
  lists: ListOption[]
  batchResult?: { addedCount: number; skippedCount: number }
  createListResult?: { ok: boolean; list?: { id: string }; error?: string }
}) {
  const { recipes, lists, batchResult = { addedCount: 1, skippedCount: 0 }, createListResult } = opts
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/api/me/collections')) {
      return { ok: true, status: 200, json: async () => ({ collections: [] }) } as Response
    }
    if (url.includes('/api/me/saved')) {
      return { ok: true, status: 200, json: async () => ({ recipes }) } as Response
    }
    if (url.includes('/items/batch')) {
      return { ok: true, status: 200, json: async () => ({ ok: true, ...batchResult }) } as Response
    }
    if (url.includes('/api/me/shopping-lists') && method === 'POST') {
      if (createListResult && !createListResult.ok) {
        return {
          ok: false,
          status: 409,
          json: async () => ({ error: createListResult.error }),
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ list: createListResult?.list ?? { id: 'lista-nova' } }),
      } as Response
    }
    if (url.includes('/api/me/shopping-lists')) {
      return { ok: true, status: 200, json: async () => ({ lists }) } as Response
    }
    throw new Error(`fetch não mockado: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderView() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SavedRecipesView />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SavedRecipesView — multi-seleção "adicionar à lista" (#530)', () => {
  it('seleciona 2 Receitas e adiciona a uma lista existente numa ação', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    mockFetch({
      recipes: [item({ id: 'r-a', name: 'Receita A' }), item({ id: 'r-b', name: 'Receita B' })],
      lists: [{ id: 'lista-1', name: 'Lista de compras' }],
      batchResult: { addedCount: 2, skippedCount: 0 },
    })
    renderView()

    expect(await screen.findByText('Receita A')).toBeInTheDocument()

    // Sem seleção: a barra não existe ainda.
    expect(screen.queryByText(M.confirmarAdicionar)).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Receita A' }))
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Receita B' }))

    expect(await screen.findByText('2 receitas selecionadas')).toBeInTheDocument()

    // O seletor de lista já veio populado com a lista existente.
    const select = await screen.findByLabelText(M.escolherLista)
    await waitFor(() => expect(select).toHaveValue('lista-1'))

    await user.click(screen.getByRole('button', { name: M.confirmarAdicionar }))

    await waitFor(() => expect(screen.getByText('2 receitas adicionadas à lista.')).toBeInTheDocument())

    // Seleção limpa depois do sucesso — a barra some, os checkboxes destravam.
    expect(screen.queryByText(M.confirmarAdicionar)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Selecionar Receita A' })).not.toBeChecked()
  })

  it('sem Listas ainda: oferece "+ Nova lista" e cria inline antes de adicionar', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      recipes: [item({ id: 'r-a', name: 'Receita A' })],
      lists: [],
      batchResult: { addedCount: 1, skippedCount: 0 },
      createListResult: { ok: true, list: { id: 'lista-nova' } },
    })
    renderView()

    expect(await screen.findByText('Receita A')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Receita A' }))

    const select = await screen.findByLabelText(M.escolherLista)
    await waitFor(() => expect(select).toHaveValue('__nova_lista__'))

    const nomeInput = screen.getByLabelText(M.nomeNovaLista)
    await user.type(nomeInput, 'Churrasco')

    await user.click(screen.getByRole('button', { name: M.confirmarAdicionar }))

    await waitFor(() => expect(screen.getByText('1 receita adicionada à lista.')).toBeInTheDocument())

    // Criou a lista ANTES do lote: POST /api/me/shopping-lists com o nome digitado.
    const createCall = fetchMock.mock.calls.find(
      ([, init]) =>
        typeof init?.body === 'string' && (init.body as string).includes('Churrasco'),
    )
    expect(createCall).toBeDefined()
  })

  it('gate ao vivo (skippedCount > 0): mostra o aviso de "algumas não puderam ser adicionadas"', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    mockFetch({
      recipes: [item({ id: 'r-a', name: 'Receita A' })],
      lists: [{ id: 'lista-1', name: 'Lista de compras' }],
      batchResult: { addedCount: 0, skippedCount: 1 },
    })
    renderView()

    expect(await screen.findByText('Receita A')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Receita A' }))
    await user.click(screen.getByRole('button', { name: M.confirmarAdicionar }))

    await waitFor(() => expect(screen.getByText(M.algumasNaoAdicionadas, { exact: false })).toBeInTheDocument())
  })

  it('cancelar a seleção limpa sem chamar o lote', async () => {
    sessionState = authed()
    const user = userEvent.setup()
    mockFetch({
      recipes: [item({ id: 'r-a', name: 'Receita A' })],
      lists: [{ id: 'lista-1', name: 'Lista de compras' }],
    })
    renderView()

    expect(await screen.findByText('Receita A')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Selecionar Receita A' }))
    expect(await screen.findByText(M.cancelarSelecao)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: M.cancelarSelecao }))

    expect(screen.queryByText(M.confirmarAdicionar)).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Selecionar Receita A' })).not.toBeChecked()
  })
})
