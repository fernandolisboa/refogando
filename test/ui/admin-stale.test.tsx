import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Traduções desatualizadas (#63, AC2). Teste de COMPONENTE jsdom (seam #54): `fetch` mockado
 * no shape REAL de `GET /api/curate/translations/stale` + `POST /api/recipes/[id]/
 * translations/[locale]/review`. Cobre: render com RÓTULO de provenance localizado, marcar
 * revisada (some por estado local, SEM mockar next/navigation → trava "sem router.refresh"),
 * erro de mutação reverte, vazio-neutro, e carga-falha + retry.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { StaleTranslations } from '@/components/admin/stale-translations'

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

const M = ptBR.traducoesStale
const RID = '22222222-2222-2222-2222-222222222222'

function oneStale() {
  return { stale: [{ recipeId: RID, locale: 'en-US', provenance: 'automatica_nao_revisada' }] }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderStale() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <StaleTranslations />
    </LocaleProvider>,
  )
}

describe('StaleTranslations (#63 AC2)', () => {
  it('renderiza item com locale + RÓTULO de provenance localizado', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
    })
    renderStale()
    expect(await screen.findByText('en-US')).toBeInTheDocument()
    expect(screen.getByText(M.provAutomaticaNaoRevisada)).toBeInTheDocument()
    expect(screen.queryByText('automatica_nao_revisada')).toBeNull()
  })

  it('marcar revisada: POST correto, item some por ESTADO LOCAL (sem router.refresh)', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`POST /api/recipes/${RID}/translations/en-US/review`]: {
        ok: true,
        status: 200,
        body: { ok: true },
      },
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.marcarRevisada }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).includes('/review'))!
    expect(String(post[0])).toBe(`/api/recipes/${RID}/translations/en-US/review`)
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(screen.queryByText('en-US')).toBeNull() // item some
  })

  it('erro de mutação (404) reverte: item volta + mensagem', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`POST /api/recipes/${RID}/translations/en-US/review`]: {
        ok: false,
        status: 404,
        body: { error: 'not_found' },
      },
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.marcarRevisada }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroGenerico)
    expect(screen.getByText('en-US')).toBeInTheDocument() // voltou
  })

  it('vazio-neutro: lista vazia → mensagem, sem alert', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: { stale: [] } },
    })
    renderStale()
    expect(await screen.findByText(M.listaVazia)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o item', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: oneStale() },
      ],
    })
    const user = userEvent.setup()
    renderStale()
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.system.error)
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('en-US')).toBeInTheDocument()
  })
})

/**
 * Edição de NOME de ingrediente traduzido (#498, ADR-0031 companheiro iii). O expansor
 * carrega `GET /api/recipes/[id]?locale=` (leitura pública já community-gated) e grava via
 * `PATCH /api/recipes/[id]/translations/[locale]` (dirty-diff: só o(s) `ordem` alterado(s)).
 */
describe('StaleTranslations — editar nomes de ingrediente (#498)', () => {
  const recipeUrl = `/api/recipes/${RID}?locale=en-US`
  const patchUrl = `/api/recipes/${RID}/translations/en-US`

  function ingredientView(ingredients: { ordem: number; rawText: string | null }[]) {
    return { ingredients }
  }

  it('expandir carrega ingredientes; edita 1 nome; salva ⇒ PATCH só com o ordem alterado', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`GET ${recipeUrl}`]: {
        ok: true,
        status: 200,
        body: ingredientView([
          { ordem: 0, rawText: 'garlic' },
          { ordem: 1, rawText: 'black beans' },
        ]),
      },
      [`PATCH ${patchUrl}`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderStale()

    await user.click(await screen.findByRole('button', { name: M.editarNomes }))
    expect(await screen.findByDisplayValue('garlic')).toBeInTheDocument()
    expect(screen.getByDisplayValue('black beans')).toBeInTheDocument()

    const input = screen.getByDisplayValue('garlic')
    await user.clear(input)
    await user.type(input, 'fresh garlic')

    await user.click(screen.getByRole('button', { name: M.salvarNomes }))
    expect(await screen.findByText(M.nomesSalvos)).toBeInTheDocument()

    const patchCall = fetchMock.mock.calls.find((c) => String(c[0]) === patchUrl)!
    const init = patchCall[1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ edits: [{ ordem: 0, nome: 'fresh garlic' }] })
  })

  it('sem edição (só abre e salva) ⇒ PATCH NÃO é chamado, mensagem de sucesso mesmo assim', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`GET ${recipeUrl}`]: {
        ok: true,
        status: 200,
        body: ingredientView([{ ordem: 0, rawText: 'garlic' }]),
      },
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.editarNomes }))
    await screen.findByDisplayValue('garlic')
    await user.click(screen.getByRole('button', { name: M.salvarNomes }))
    expect(await screen.findByText(M.nomesSalvos)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => String(c[0]) === patchUrl)).toBe(false)
  })

  it('ingrediente SEM nome (rawText null) é filtrado do editor', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`GET ${recipeUrl}`]: {
        ok: true,
        status: 200,
        body: ingredientView([
          { ordem: 0, rawText: 'garlic' },
          { ordem: 1, rawText: null },
        ]),
      },
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.editarNomes }))
    expect(await screen.findByDisplayValue('garlic')).toBeInTheDocument()
    // Só 1 input (o ordem=1 sem nome não vira campo editável).
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('erro de CARGA dos ingredientes ⇒ alert dedicado', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`GET ${recipeUrl}`]: { ok: false, status: 404, body: { error: 'not_found' } },
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.editarNomes }))
    expect(await screen.findByText(M.erroCarregarIngredientes)).toBeInTheDocument()
  })

  it('erro ao SALVAR (PATCH 400) ⇒ alert dedicado, editor permanece aberto', async () => {
    mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`GET ${recipeUrl}`]: {
        ok: true,
        status: 200,
        body: ingredientView([{ ordem: 0, rawText: 'garlic' }]),
      },
      [`PATCH ${patchUrl}`]: { ok: false, status: 400, body: { error: 'dados_invalidos' } },
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.editarNomes }))
    const input = await screen.findByDisplayValue('garlic')
    await user.clear(input)
    await user.type(input, 'fresh garlic')
    await user.click(screen.getByRole('button', { name: M.salvarNomes }))
    expect(await screen.findByText(M.erroSalvarNomes)).toBeInTheDocument()
    expect(screen.getByDisplayValue('fresh garlic')).toBeInTheDocument() // input preserva o valor
  })

  it('fechar (toggle) reseta o editor: reabrir refaz o fetch e descarta edição não salva', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/translations/stale': { ok: true, status: 200, body: oneStale() },
      [`GET ${recipeUrl}`]: [
        { ok: true, status: 200, body: ingredientView([{ ordem: 0, rawText: 'garlic' }]) },
        { ok: true, status: 200, body: ingredientView([{ ordem: 0, rawText: 'garlic' }]) },
      ],
    })
    const user = userEvent.setup()
    renderStale()
    await user.click(await screen.findByRole('button', { name: M.editarNomes }))
    const input = await screen.findByDisplayValue('garlic')
    await user.clear(input)
    await user.type(input, 'unsaved edit')

    // Fecha (mesmo botão vira "Fechar").
    await user.click(screen.getByRole('button', { name: M.fecharNomes }))
    expect(screen.queryByDisplayValue('unsaved edit')).toBeNull()

    // Reabre: refaz o GET, edição não salva descartada.
    await user.click(screen.getByRole('button', { name: M.editarNomes }))
    expect(await screen.findByDisplayValue('garlic')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === recipeUrl)).toHaveLength(2)
  })
})
