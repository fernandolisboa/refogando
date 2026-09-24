import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Traduções para re-revisão do Curador (#500, ADR-0031 dec.6). Componente jsdom (seam #54):
 * `fetch` mockado no shape REAL de `GET /api/curate/translations/divergent-stale`. Cobre:
 * render com rótulo de proveniência localizado, vazio-neutro, erro de carga+retry, e o editor
 * de nomes de ingrediente (mesma ação de #498, reusada aqui).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { DivergentStaleTranslations } from '@/components/admin/divergent-stale-translations'

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

const M = ptBR.traducoesDivergentes
const S = ptBR.traducoesStale
const RID = '33333333-3333-3333-3333-333333333333'

function oneDivergent() {
  return {
    divergentStale: [{ recipeId: RID, locale: 'en-US', provenance: 'automatica_nao_revisada' }],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderDivergent() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <DivergentStaleTranslations />
    </LocaleProvider>,
  )
}

describe('DivergentStaleTranslations (#500)', () => {
  it('renderiza item com locale + RÓTULO de provenance localizado', async () => {
    mockFetch({
      'GET /api/curate/translations/divergent-stale': { ok: true, status: 200, body: oneDivergent() },
    })
    renderDivergent()
    expect(await screen.findByText('en-US')).toBeInTheDocument()
    expect(screen.getByText(S.provAutomaticaNaoRevisada)).toBeInTheDocument()
    expect(screen.queryByText('automatica_nao_revisada')).toBeNull()
    // Sem ação "marcar revisada" nesta lista (não é a trava; fingerprint é — ADR-0031 dec.2).
    expect(screen.queryByRole('button', { name: S.marcarRevisada })).toBeNull()
  })

  it('vazio-neutro: lista vazia → mensagem, sem alert', async () => {
    mockFetch({
      'GET /api/curate/translations/divergent-stale': { ok: true, status: 200, body: { divergentStale: [] } },
    })
    renderDivergent()
    expect(await screen.findByText(M.listaVazia)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o item', async () => {
    mockFetch({
      'GET /api/curate/translations/divergent-stale': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: oneDivergent() },
      ],
    })
    const user = userEvent.setup()
    renderDivergent()
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.system.error)
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('en-US')).toBeInTheDocument()
  })

  it('editar nomes: expandir carrega ingredientes; edita 1 nome; salva ⇒ PATCH só com o ordem alterado', async () => {
    const recipeUrl = `/api/recipes/${RID}?locale=en-US`
    const patchUrl = `/api/recipes/${RID}/translations/en-US`
    const fetchMock = mockFetch({
      'GET /api/curate/translations/divergent-stale': { ok: true, status: 200, body: oneDivergent() },
      [`GET ${recipeUrl}`]: {
        ok: true,
        status: 200,
        body: { ingredients: [{ ordem: 0, rawText: 'garlic' }] },
      },
      [`PATCH ${patchUrl}`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderDivergent()

    await user.click(await screen.findByRole('button', { name: S.editarNomes }))
    const input = await screen.findByDisplayValue('garlic')
    await user.clear(input)
    await user.type(input, 'fresh garlic')
    await user.click(screen.getByRole('button', { name: S.salvarNomes }))
    expect(await screen.findByText(S.nomesSalvos)).toBeInTheDocument()

    const patchCall = fetchMock.mock.calls.find((c) => String(c[0]) === patchUrl)!
    const init = patchCall[1] as RequestInit
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body as string)).toEqual({ edits: [{ ordem: 0, nome: 'fresh garlic' }] })
  })
})
