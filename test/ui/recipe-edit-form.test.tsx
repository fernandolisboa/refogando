import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste jsdom do formulário de edição IN-PLACE + apagar (#21 UI / #61). `fetch` mockado no shape
 * REAL: `PATCH /api/recipes/[id]` ({ ok, was_public }) e `DELETE /api/recipes/[id]` (204).
 * `next/navigation` (router.refresh/push) e LocaleProvider reais (locale via provider).
 * Asserções: PATCH na privada (direto), confirmação ANTES de gravar na pública, diálogo de apagar
 * (role=dialog/aria-modal/Escape/foco de volta), en-US, sem âmbar.
 */

const refresh = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { RecipeEditForm } from '@/components/recipe/recipe-edit-form'

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

function renderForm(view: RecipeView, locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeEditForm view={view} locale={locale} />
    </LocaleProvider>,
  )
}

function semAmbar(container: HTMLElement) {
  expect(container.querySelector('[class*="aviso"]')).toBeNull()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  refresh.mockClear()
  push.mockClear()
})

describe('RecipeEditForm (#21/#61)', () => {
  it('T1 — privada: prefilled; Salvar faz PATCH direto e router.refresh (sem diálogo)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true, was_public: false } }))
    renderForm(ownerView({ visibility: 'private' }))

    // Prefilled a partir da view.
    expect(screen.getByDisplayValue('Bolo simples')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Doce caseiro')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: M.editarPublicaConfirmar }))

    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1')
    expect((call[1] as RequestInit).method).toBe('PATCH')
    expect(refresh).toHaveBeenCalled()
    // Nenhum diálogo abriu (privada não confirma).
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('T2 — pública: Salvar abre confirmação ANTES do PATCH; confirmar dispara o PATCH', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch(() => ({ status: 200, body: { ok: true, was_public: true } }))
    renderForm(ownerView({ visibility: 'public' }))

    await user.click(screen.getByRole('button', { name: M.editarPublicaConfirmar }))
    // O PATCH ainda NÃO rodou: abriu o diálogo de confirmação.
    expect(fetchMock).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText(M.editarPublicaAviso)).toBeInTheDocument()

    // Confirmar grava.
    await user.click(within(dialog).getByRole('button', { name: M.editarPublicaConfirmar }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
  })

  it('T3 — apagar: diálogo a11y (role/aria-modal), Escape fecha e devolve o foco; confirmar DELETE', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((method) =>
      method === 'DELETE' ? { status: 204 } : { status: 200, body: { ok: true, was_public: false } },
    )
    const { container } = renderForm(ownerView({ visibility: 'private' }))

    const apagarBtn = screen.getByRole('button', { name: ptBR.minhasCriacoes.apagar })
    await user.click(apagarBtn)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText(M.apagarAviso)).toBeInTheDocument()
    semAmbar(container)

    // Escape fecha e devolve o foco ao gatilho.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(apagarBtn).toHaveFocus()

    // Reabre e confirma o apagar → DELETE + navega pra /me/recipes.
    await user.click(apagarBtn)
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: M.apagarConfirmar }),
    )
    const del = fetchMock.mock.calls.find((c) => (c[1] as RequestInit).method === 'DELETE')
    expect(del).toBeDefined()
    expect(String(del![0])).toBe('/api/recipes/r-1')
    expect(push).toHaveBeenCalledWith('/me/recipes')
  })

  it('T4 — en-US: confirmação de apagar em inglês', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 204 }))
    renderForm(ownerView({ visibility: 'private' }), 'en-US')
    await user.click(screen.getByRole('button', { name: enUS.minhasCriacoes.apagar }))
    expect(within(screen.getByRole('dialog')).getByText(enUS.edicaoPropria.apagarAviso)).toBeInTheDocument()
  })
})
