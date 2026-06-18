import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Curadoria de catálogo (#63, AC3). Teste de COMPONENTE jsdom (seam #54): `fetch` mockado no
 * shape REAL de `GET /api/curate/promotion` + `POST /api/curate/ingredients`. Cobre: render
 * do ingrediente recorrente + contagem, promover (payload `{translations:[{locale,nome}]}` no
 * locale atual; item some por ESTADO LOCAL, SEM mockar next/navigation → trava "sem
 * router.refresh"), 409 slug_em_uso reverte, vazio-neutro, e carga-falha + retry.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CatalogCuration } from '@/components/admin/catalog-curation'

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

const M = ptBR.curadoria

function onePromotion() {
  return { promotion: [{ rawText: 'alho', count: 5 }] }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderCuradoria() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CatalogCuration />
    </LocaleProvider>,
  )
}

describe('CatalogCuration (#63 AC3)', () => {
  it('renderiza o ingrediente recorrente + contagem e o heading da seção', async () => {
    mockFetch({ 'GET /api/curate/promotion': { ok: true, status: 200, body: onePromotion() } })
    renderCuradoria()
    expect(await screen.findByText('alho')).toBeInTheDocument()
    // Contagem de aparições do ingrediente recorrente. Ancorado no rótulo "Aparições: 5" —
    // /5/ cru agora colidiria com o label "Dificuldade (1 a 5)" do form de criação (#85).
    expect(screen.getByText(new RegExp(`${M.aparicoes}: 5`))).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: M.titulo })).toBeInTheDocument()
  })

  it('promover: POST com body no locale atual, item some por ESTADO LOCAL', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/promotion': { ok: true, status: 200, body: onePromotion() },
      'POST /api/curate/ingredients': { ok: true, status: 200, body: { id: 'ing1' } },
    })
    const user = userEvent.setup()
    renderCuradoria()
    await user.click(await screen.findByRole('button', { name: M.promover }))

    const post = fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'POST')!
    expect(String(post[0])).toBe('/api/curate/ingredients')
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      translations: [{ locale: 'pt-BR', nome: 'alho' }],
    })
    expect(screen.queryByText('alho')).toBeNull() // item some
  })

  it('slug_em_uso (409) reverte: item volta + mensagem', async () => {
    mockFetch({
      'GET /api/curate/promotion': { ok: true, status: 200, body: onePromotion() },
      'POST /api/curate/ingredients': { ok: false, status: 409, body: { error: 'slug_em_uso' } },
    })
    const user = userEvent.setup()
    renderCuradoria()
    await user.click(await screen.findByRole('button', { name: M.promover }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroSlugEmUso)
    expect(screen.getByText('alho')).toBeInTheDocument() // voltou
  })

  it('vazio-neutro: promotion vazio → mensagem, sem alert', async () => {
    mockFetch({ 'GET /api/curate/promotion': { ok: true, status: 200, body: { promotion: [] } } })
    renderCuradoria()
    expect(await screen.findByText(M.promocaoVazia)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o item', async () => {
    mockFetch({
      'GET /api/curate/promotion': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: onePromotion() },
      ],
    })
    const user = userEvent.setup()
    renderCuradoria()
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.system.error)
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('alho')).toBeInTheDocument()
  })
})
