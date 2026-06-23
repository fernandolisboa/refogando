import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste jsdom do MODAL centrado de edição IN-PLACE (#192/ADR-0021). O "Editar" abre o modal
 * (Sheet `side="center"`, Radix Dialog); editar e Salvar grava via `PATCH /api/recipes/[id]`
 * IN-PLACE (mesma Receita, sem criar derivada) e FECHA o modal; adicionar/remover ingrediente e
 * passo; Apagar com confirmação a partir do modal. `next/navigation` e LocaleProvider reais.
 *
 * Os polyfills de ponteiro/ResizeObserver do Radix vêm do test/ui/setup.ts (Dialog central).
 */

const refresh = vi.fn()
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import type { Locale } from '@/i18n/locale'
import { RecipeEditModal } from '@/components/recipe/recipe-edit-modal'

const M = ptBR.edicaoPropria

function ownerView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Bolo simples',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Doce caseiro', passos: ['Misture', 'Asse'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'sobremesa', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 0, quantidade: '2.000', unidade: 'xicara', rawText: 'farinha' }],
    translations: [],
    autoTranslationSignal: false,
    canManage: true,
    visibility: 'private',
    resultKind: 'success',
    ...over,
  }
}

type FetchResult = { status: number; body?: unknown }
function mockFetch(byMethod: (method: string) => FetchResult) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    const r = byMethod(method)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderModal(view: RecipeView, locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeEditModal view={view} />
    </LocaleProvider>,
  )
}

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: ptBR.minhasCriacoes.editar }))
  return screen.findByRole('dialog')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  refresh.mockClear()
  push.mockClear()
  replace.mockClear()
})

describe('RecipeEditModal (#192)', () => {
  it('fechado por padrão: nenhum dialog montado; "Editar" abre o modal centralizado com nome acessível', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const dialog = await openModal(user)
    // Radix nomeia o painel pelo SheetTitle (aria-labelledby) — o contrato de a11y do modal.
    expect(dialog).toHaveAccessibleName(M.modalTitulo)
    // Prefilled a partir da view (conteúdo editável dentro do modal).
    expect(within(dialog).getByDisplayValue('Bolo simples')).toBeInTheDocument()
    expect(within(dialog).getByDisplayValue('Doce caseiro')).toBeInTheDocument()
  })

  it('ESC fecha o modal', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    await openModal(user)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('editar e Salvar grava IN-PLACE (PATCH na mesma receita, sem criar derivada) e fecha o modal', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView({ visibility: 'private' }))
    const dialog = await openModal(user)

    const titulo = within(dialog).getByDisplayValue('Bolo simples')
    await user.clear(titulo)
    await user.type(titulo, 'Bolo de fubá')

    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))

    // PATCH IN-PLACE na MESMA URL/receita; NUNCA POST (que criaria uma derivada).
    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1')
    expect((call[1] as RequestInit).method).toBe('PATCH')
    const sent = JSON.parse((call[1] as RequestInit).body as string)
    expect(sent.titulo).toBe('Bolo de fubá')
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).method !== 'POST')).toBe(true)
    expect(refresh).toHaveBeenCalled()

    // Salvou ⇒ o modal fecha.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('adicionar e remover ingrediente funcionam dentro do modal', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    const dialog = await openModal(user)

    const before = within(dialog).getAllByRole('listitem')
    await user.click(within(dialog).getByRole('button', { name: ptBR.criar.adicionarIngrediente }))
    expect(within(dialog).getAllByRole('listitem').length).toBe(before.length + 1)

    // Remove o primeiro item (há ≥ 2 agora, então o remover não está desabilitado).
    const removers = within(dialog).getAllByRole('button', { name: /Remover ingrediente 1/ })
    await user.click(removers[0])
    expect(within(dialog).getAllByRole('listitem').length).toBe(before.length)
  })

  it('adicionar passo: o textarea de passos aceita novas linhas (passo adicional)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    const dialog = await openModal(user)

    // O modo de preparo é um textarea (um passo por linha). Acrescenta um passo e salva.
    const passos = within(dialog).getByLabelText(ptBR.detalhe.passos)
    await user.click(passos)
    await user.keyboard('{End}')
    await user.type(passos, '\nSirva')

    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.passos).toEqual(['Misture', 'Asse', 'Sirva'])
  })

  it('Apagar com confirmação a partir do modal: confirma → DELETE e navega para /me/recipes', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((method) =>
      method === 'DELETE' ? { status: 204 } : { status: 200, body: { ok: true } },
    )
    renderModal(ownerView())
    const dialog = await openModal(user)

    await user.click(within(dialog).getByRole('button', { name: ptBR.minhasCriacoes.apagar }))

    // O diálogo de confirmação de apagar abre (sobre o modal).
    const confirm = await screen.findByText(M.apagarAviso)
    expect(confirm).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.apagarConfirmar }))

    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit).method === 'DELETE')
    expect(del).toBeDefined()
    expect(String(del![0])).toBe('/api/recipes/r-1')
    expect(push).toHaveBeenCalledWith('/me/recipes')
  })

  it('Cancelar fecha o modal sem nenhum PATCH', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true } }))
    renderModal(ownerView())
    const dialog = await openModal(user)

    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaCancelar }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
