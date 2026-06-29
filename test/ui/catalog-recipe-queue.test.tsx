import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Fila de curadoria de RECEITAS de catálogo (#238, ADR-0026). Teste de COMPONENTE jsdom (seam #54):
 * `fetch` mockado no shape REAL de `GET /api/curate/recipes/queue` + `POST .../[id]/{approve,reject,
 * unreject}`. `createdAt` chega como STRING. NÃO mocka next/navigation (trava "sem router.refresh":
 * se alguém adicionar refresh, o render lança sem AppRouterContext). Cobre: render dos pendentes,
 * aprovar (card some + POST), rejeitar com nota (move pra Rejeitadas), 409 reverte, vazio, falha+retry.
 */
import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CatalogRecipeQueue } from '@/components/admin/catalog-recipe-queue'

const COZINHAS = [
  { value: 'italiana', label: 'Italiana' },
  { value: 'japonesa', label: 'Japonesa' },
]

const M = ptBR.curadoria

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }

function mockFetch(routes: Record<string, FetchResult | FetchResult[]>) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    const key = `${method} ${url}`
    const entry = routes[key]
    if (entry === undefined) throw new Error(`fetch não mockado: ${key}`)
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'

function pending(id: string, titulo: string, cozinha = 'italiana') {
  return {
    recipeId: id,
    titulo,
    locale: 'pt-BR',
    cozinha,
    categoria: 'prato_principal',
    porcoes: 4,
    dificuldade: 3,
    curationStatus: 'pending',
    createdAt: '2026-06-29T00:00:00.000Z',
    reviewNote: null,
  }
}

function renderQueue() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaVocabProvider value={COZINHAS}>
        <CatalogRecipeQueue />
      </CozinhaVocabProvider>
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('CatalogRecipeQueue', () => {
  it('renderiza os rascunhos pendentes (título + meta)', async () => {
    mockFetch({ 'GET /api/curate/recipes/queue': { ok: true, status: 200, body: { queue: [pending(A, 'Carbonara')], rejected: [] } } })
    renderQueue()
    expect(await screen.findByText('Carbonara')).toBeInTheDocument()
    expect(screen.getByText(/Cozinha: Italiana/)).toBeInTheDocument() // meta com rótulo localizado (não o slug)
  })

  it('aprovar: POST correto e o card some', async () => {
    const f = mockFetch({
      'GET /api/curate/recipes/queue': { ok: true, status: 200, body: { queue: [pending(A, 'Carbonara')], rejected: [] } },
      [`POST /api/curate/recipes/${A}/approve`]: { ok: true, status: 200, body: { ok: true } },
    })
    renderQueue()
    await screen.findByText('Carbonara')
    await userEvent.click(screen.getByRole('button', { name: M.filaAprovar }))
    expect(f).toHaveBeenCalledWith(`/api/curate/recipes/${A}/approve`, expect.objectContaining({ method: 'POST' }))
    expect(screen.queryByText('Carbonara')).not.toBeInTheDocument()
  })

  it('rejeitar com nota: abre painel, confirma, card vai pra Rejeitadas', async () => {
    mockFetch({
      'GET /api/curate/recipes/queue': { ok: true, status: 200, body: { queue: [pending(A, 'Ratatouille')], rejected: [] } },
      [`POST /api/curate/recipes/${A}/reject`]: { ok: true, status: 200, body: { ok: true } },
    })
    renderQueue()
    await screen.findByText('Ratatouille')
    await userEvent.click(screen.getByRole('button', { name: M.filaRejeitar }))
    await userEvent.type(screen.getByLabelText(M.filaRejeitarNota), 'duplicata')
    await userEvent.click(screen.getByRole('button', { name: M.filaRejeitarConfirmar }))
    // saiu da fila ativa; aparece na seção Rejeitadas (com a nota)
    expect(screen.getByText(/duplicata/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.filaRestaurar })).toBeInTheDocument()
  })

  it('409 ao aprovar ⇒ card permanece + alerta de erro', async () => {
    mockFetch({
      'GET /api/curate/recipes/queue': { ok: true, status: 200, body: { queue: [pending(A, 'Carbonara'), pending(B, 'Tiramisù')], rejected: [] } },
      [`POST /api/curate/recipes/${A}/approve`]: { ok: false, status: 409, body: { error: 'estado_invalido' } },
    })
    renderQueue()
    await screen.findByText('Carbonara')
    await userEvent.click(screen.getAllByRole('button', { name: M.filaAprovar })[0])
    expect(screen.getByText('Carbonara')).toBeInTheDocument() // não sumiu
    expect(screen.getByText(M.filaErro)).toBeInTheDocument()
  })

  it('fila vazia ⇒ mensagem neutra', async () => {
    mockFetch({ 'GET /api/curate/recipes/queue': { ok: true, status: 200, body: { queue: [], rejected: [] } } })
    renderQueue()
    expect(await screen.findByText(M.filaVazia)).toBeInTheDocument()
  })

  it('falha de carga ⇒ erro + retry recarrega', async () => {
    mockFetch({
      'GET /api/curate/recipes/queue': [
        { ok: false, status: 500, body: {} },
        { ok: true, status: 200, body: { queue: [pending(A, 'Carbonara')], rejected: [] } },
      ],
    })
    renderQueue()
    const retry = await screen.findByRole('button', { name: ptBR.system.retry })
    await userEvent.click(retry)
    expect(await screen.findByText('Carbonara')).toBeInTheDocument()
  })

  it('filtro por cozinha: mostra só a cozinha escolhida', async () => {
    mockFetch({
      'GET /api/curate/recipes/queue': {
        ok: true,
        status: 200,
        body: { queue: [pending(A, 'Carbonara', 'italiana'), pending(B, 'Sushi', 'japonesa')], rejected: [] },
      },
    })
    renderQueue()
    await screen.findByText('Carbonara')
    expect(screen.getByText('Sushi')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText(M.filaCozinha), 'japonesa')
    expect(screen.queryByText('Carbonara')).not.toBeInTheDocument()
    expect(screen.getByText('Sushi')).toBeInTheDocument()
  })

  it('busca por título filtra a lista', async () => {
    mockFetch({
      'GET /api/curate/recipes/queue': {
        ok: true,
        status: 200,
        body: { queue: [pending(A, 'Carbonara'), pending(B, 'Tiramisù')], rejected: [] },
      },
    })
    renderQueue()
    await screen.findByText('Carbonara')
    await userEvent.type(screen.getByLabelText(M.filtroBusca), 'tira')
    expect(screen.queryByText('Carbonara')).not.toBeInTheDocument()
    expect(screen.getByText('Tiramisù')).toBeInTheDocument()
  })

  it('paginação: mostra 20 + "Ver mais" revela o resto', async () => {
    const many = Array.from({ length: 25 }, (_, i) => pending(`r${i}`, `Receita ${i}`))
    mockFetch({ 'GET /api/curate/recipes/queue': { ok: true, status: 200, body: { queue: many, rejected: [] } } })
    renderQueue()
    await screen.findByText('Receita 0')
    expect(screen.getByText('Receita 19')).toBeInTheDocument()
    expect(screen.queryByText('Receita 20')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(M.filaVerMais) }))
    expect(screen.getByText('Receita 20')).toBeInTheDocument()
    expect(screen.getByText('Receita 24')).toBeInTheDocument()
  })
})
