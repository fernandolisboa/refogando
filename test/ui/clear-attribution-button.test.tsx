import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do botão LGPD remover-nome-da-fonte (#272). `useRouter` mockado (refresh), `fetch` no
 * shape de POST /api/recipes/[id]/clear-attribution. Cobre o self-gating (só importada COM nome humano),
 * o confirm inline, o 200→refresh e o erro.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ClearAttributionButton } from '@/components/recipe/clear-attribution-button'
import type { RecipeView } from '@/domain/recipe-read'

const m = ptBR.detalhe

function makeView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    origin: 'web_imported',
    source: { url: 'https://exemplo.com/r', name: 'Cozinha da Vovó' },
    canManage: true,
    ...over,
  } as unknown as RecipeView
}

function renderButton(view: RecipeView) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ClearAttributionButton view={view} />
    </LocaleProvider>,
  )
}

function stubFetch(status: number) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    if (!String(input).includes('/clear-attribution')) throw new Error(`fetch não mockado: ${String(input)}`)
    return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  refresh.mockClear()
})

describe('ClearAttributionButton (#272 LGPD)', () => {
  it('não renderiza nada quando NÃO é web_imported', () => {
    const { container } = renderButton(makeView({ origin: 'ai_structured' }))
    expect(container).toBeEmptyDOMElement()
  })

  it('não renderiza nada quando o source.name é só o host (nada humano a remover)', () => {
    renderButton(makeView({ source: { url: 'https://exemplo.com/r', name: 'exemplo.com' } }))
    expect(screen.queryByRole('button', { name: m.removerNomeFonte })).not.toBeInTheDocument()
  })

  it('não renderiza nada quando não há source.name', () => {
    renderButton(makeView({ source: { url: 'https://exemplo.com/r' } }))
    expect(screen.queryByRole('button', { name: m.removerNomeFonte })).not.toBeInTheDocument()
  })

  it('importada com nome humano → mostra o botão; confirmar → POST 200 → router.refresh', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch(200)
    renderButton(makeView())

    await user.click(screen.getByRole('button', { name: m.removerNomeFonte }))
    // confirm inline aparece
    expect(screen.getByText(m.removerNomeFonteAjuda)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: m.removerNomeFonteConfirma }))

    expect(fetchMock).toHaveBeenCalledWith('/api/recipes/r-1/clear-attribution', { method: 'POST' })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('cancelar volta ao botão sem chamar a rota', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch(200)
    renderButton(makeView())

    await user.click(screen.getByRole('button', { name: m.removerNomeFonte }))
    await user.click(screen.getByRole('button', { name: m.removerNomeFonteCancela }))

    expect(screen.getByRole('button', { name: m.removerNomeFonte })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('falha do POST → alerta de erro, sem refresh', async () => {
    const user = userEvent.setup()
    stubFetch(500)
    renderButton(makeView())

    await user.click(screen.getByRole('button', { name: m.removerNomeFonte }))
    await user.click(screen.getByRole('button', { name: m.removerNomeFonteConfirma }))

    expect(await screen.findByRole('alert')).toHaveTextContent(m.removerNomeFonteErro)
    expect(refresh).not.toHaveBeenCalled()
  })
})
