import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Atendimento ao autor externo (#396/GAP-4) — teste de COMPONENTE jsdom (seam #54): `fetch` mockado no
 * shape de `POST /api/admin/attribution/clear`. Cobre: PRÉVIA (apply:false → conta), REMOVER (apply:true
 * → contagem removida), botões desabilitados sem critério, e o erro de caseId inválido do servidor.
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { OperatorAttributionSection } from '@/components/admin/operator-attribution-section'

const A = ptBR.admin

type Resp = { ok: boolean; status: number; body: unknown }
function mockFetch(entry: Resp) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const init = args[1]
    calls.push({
      method: (init?.method ?? 'GET').toUpperCase(),
      url: String(args[0]),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    })
    return { ok: entry.ok, status: entry.status, json: async () => entry.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { calls }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <OperatorAttributionSection />
    </LocaleProvider>,
  )
}

describe('OperatorAttributionSection (#396 GAP-4)', () => {
  it('sem critério: os dois botões ficam desabilitados', () => {
    mockFetch({ ok: true, status: 200, body: {} })
    renderSection()
    expect(screen.getByRole('button', { name: A.takedownPrevia })).toBeDisabled()
    expect(screen.getByRole('button', { name: A.takedownRemover })).toBeDisabled()
  })

  it('prévia: preenche nome → POST apply:false + mostra contagem e o nome distinto', async () => {
    const { calls } = mockFetch({
      ok: true,
      status: 200,
      body: { applied: false, matched: 3, recipeIds: ['a', 'b'], distinctSourceNames: ['Cozinha da Vovó'] },
    })
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownNomeLabel), 'Cozinha da Vovó')
    await user.click(screen.getByRole('button', { name: A.takedownPrevia }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/admin/attribution/clear')
    expect(post.body).toMatchObject({ sourceName: 'Cozinha da Vovó', apply: false })
    expect(
      await screen.findByText(
        A.takedownPreviaResultado.replace('{casaram}', '3').replace('{removiveis}', '2'),
      ),
    ).toBeInTheDocument()
    // A prévia expõe o rótulo + o nome distinto que será zerado (não só a contagem).
    expect(screen.getByText(A.takedownNomesRemovidos)).toBeInTheDocument()
    expect(screen.getByText('Cozinha da Vovó', { selector: 'li' })).toBeInTheDocument()
  })

  it('prévia por nome+url: lista TODOS os nomes distintos que casaram (inclui o arrastado pela url)', async () => {
    // Cenário do achado: o ramo de URL casa outro import da MESMA url com um nome DIFERENTE do que o
    // operador digitou — a prévia precisa mostrar esse nome para conferência antes de aplicar.
    mockFetch({
      ok: true,
      status: 200,
      body: {
        applied: false,
        matched: 2,
        recipeIds: ['a', 'b'],
        distinctSourceNames: ['Cozinha da Vovó', 'Marca Nova'],
      },
    })
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownNomeLabel), 'Cozinha da Vovó')
    await user.type(screen.getByLabelText(A.takedownUrlLabel), 'https://exemplo.com/r')
    await user.click(screen.getByRole('button', { name: A.takedownPrevia }))

    expect(await screen.findByText(A.takedownNomesRemovidos)).toBeInTheDocument()
    expect(screen.getByText('Cozinha da Vovó', { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByText('Marca Nova', { selector: 'li' })).toBeInTheDocument()
  })

  it('remover: POST apply:true + mostra quantas tiveram o nome removido', async () => {
    const { calls } = mockFetch({
      ok: true,
      status: 200,
      body: { applied: true, matched: 2, recipeIds: ['a', 'b'], distinctSourceNames: ['Chef'] },
    })
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownUrlLabel), 'https://exemplo.com/r')
    await user.click(screen.getByRole('button', { name: A.takedownRemover }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({ apply: true })
    expect(
      await screen.findByText(A.takedownRemovido.replace('{removiveis}', '2')),
    ).toBeInTheDocument()
  })

  it('remover sem casar nada removível → copy "nada a remover"', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: { applied: true, matched: 1, recipeIds: [], distinctSourceNames: [] },
    })
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownNomeLabel), 'www.exemplo.com')
    await user.click(screen.getByRole('button', { name: A.takedownRemover }))

    expect(await screen.findByText(A.takedownNada)).toBeInTheDocument()
  })

  it('servidor 400 case_id_invalido → alert com a copy própria', async () => {
    mockFetch({ ok: false, status: 400, body: { error: 'case_id_invalido' } })
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownNomeLabel), 'Chef')
    await user.click(screen.getByRole('button', { name: A.takedownPrevia }))

    expect(await screen.findByRole('alert')).toHaveTextContent(A.takedownCaseIdInvalido)
  })
})
