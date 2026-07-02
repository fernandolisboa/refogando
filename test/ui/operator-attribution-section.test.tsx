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

/**
 * Escalada além do nome (#397/GAP-3): desvincular a URL / apagar a importada. `fetch` mockado responde
 * conforme o `apply` do corpo (prévia vs. aplicar). Cobre: aviso de política, prévia mostra escopo
 * (URLs), confirmação destrutiva só aparece APÓS a prévia, e a copy de sucesso por ação.
 */
function mockEscalateFetch(byApply: (apply: boolean) => Resp) {
  const calls: { method: string; url: string; body: { apply?: boolean; action?: string } }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const init = args[1]
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(args[0]), body })
    const entry = byApply(body.apply === true)
    return { ok: entry.ok, status: entry.status, json: async () => entry.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { calls }
}

describe('OperatorAttributionSection — escalada além do nome (#397 GAP-3)', () => {
  it('mostra o aviso de que a POLÍTICA aguarda sign-off jurídico', () => {
    mockFetch({ ok: true, status: 200, body: {} })
    renderSection()
    expect(screen.getByText(A.escalonarAviso)).toBeInTheDocument()
  })

  it('confirmação destrutiva NÃO aparece antes da prévia', () => {
    mockFetch({ ok: true, status: 200, body: {} })
    renderSection()
    expect(screen.queryByRole('button', { name: A.escalonarConfirmUnlink })).toBeNull()
    expect(screen.queryByRole('button', { name: A.escalonarConfirmDelete })).toBeNull()
  })

  it('prévia de desvincular: POST escalate apply:false, mostra escopo (URLs) e habilita a confirmação', async () => {
    const { calls } = mockEscalateFetch(() => ({
      ok: true,
      status: 200,
      body: {
        applied: false,
        action: 'url_unlink',
        matched: 2,
        recipeIds: ['a', 'b'],
        distinctSourceNames: ['Cozinha da Vovó'],
        distinctSourceUrls: ['https://exemplo.com/r'],
      },
    }))
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownUrlLabel), 'https://exemplo.com/r')
    await user.click(screen.getByRole('button', { name: A.escalonarPrevia }))

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/admin/attribution/escalate')
    expect(post.body).toMatchObject({ action: 'url_unlink', apply: false })
    // Escopo: rótulo de URLs + a URL afetada.
    expect(await screen.findByText(A.escalonarUrlsAfetadas)).toBeInTheDocument()
    expect(screen.getByText('https://exemplo.com/r', { selector: 'li' })).toBeInTheDocument()
    // A confirmação destrutiva agora está disponível.
    expect(screen.getByRole('button', { name: A.escalonarConfirmUnlink })).toBeInTheDocument()
    // E, junto dela, o aviso de UNIÃO (nome OU url) + IRREVERSÍVEL para o operador ler antes de confirmar.
    expect(screen.getByText(A.escalonarUniaoAviso)).toBeInTheDocument()
  })

  it('o aviso de UNIÃO/irreversível só aparece junto da confirmação (não antes da prévia)', async () => {
    mockEscalateFetch(() => ({
      ok: true,
      status: 200,
      body: {
        applied: false,
        action: 'url_unlink',
        matched: 1,
        recipeIds: ['a'],
        distinctSourceNames: ['X'],
        distinctSourceUrls: ['https://exemplo.com/r'],
      },
    }))
    const user = userEvent.setup()
    renderSection()

    // Antes de qualquer prévia: sem aviso (não há confirmação destrutiva à vista).
    expect(screen.queryByText(A.escalonarUniaoAviso)).toBeNull()

    await user.type(screen.getByLabelText(A.takedownUrlLabel), 'https://exemplo.com/r')
    await user.click(screen.getByRole('button', { name: A.escalonarPrevia }))

    // Depois da prévia com escopo > 0: o aviso aparece ao lado da confirmação.
    expect(await screen.findByText(A.escalonarUniaoAviso)).toBeInTheDocument()
  })

  it('apagar importada: prévia → confirmar → POST apply:true e copy de deleção', async () => {
    const { calls } = mockEscalateFetch((apply) => ({
      ok: true,
      status: 200,
      body: {
        applied: apply,
        action: 'record_deletion',
        matched: 1,
        recipeIds: ['x'],
        distinctSourceNames: ['Chef'],
        distinctSourceUrls: ['https://exemplo.com/r'],
      },
    }))
    const user = userEvent.setup()
    renderSection()

    await user.type(screen.getByLabelText(A.takedownUrlLabel), 'https://exemplo.com/r')
    await user.click(screen.getByLabelText(A.escalonarAcaoDelete)) // escolhe "apagar"
    await user.click(screen.getByRole('button', { name: A.escalonarPrevia }))

    const confirm = await screen.findByRole('button', { name: A.escalonarConfirmDelete })
    await user.click(confirm)

    await waitFor(() =>
      expect(calls.some((c) => c.body.apply === true && c.body.action === 'record_deletion')).toBe(
        true,
      ),
    )
    expect(
      await screen.findByText(A.escalonarDeleteOk.replace('{n}', '1')),
    ).toBeInTheDocument()
  })
})
