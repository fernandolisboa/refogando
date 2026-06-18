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
