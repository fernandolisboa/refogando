import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Fila PROATIVA do Curador (#227, ADR-0022 dec.3). Teste de COMPONENTE jsdom (seam #54): `fetch`
 * mockado no shape REAL de `GET /api/curate/review-images` + `POST .../[imageId]/{remove,dismiss}`.
 * `createdAt` chega como STRING ISO (passou por `res.json()`). Cobre: render do card com contexto
 * (título/autor/refino), REMOVER com motivo obrigatório (payload + card some), DISPENSAR (POST sem
 * corpo + card some), reversões no erro, vazio-neutro, carga-falha + retry.
 *
 * NÃO mocka next/navigation: as ações mudam só estado local; um `router.refresh()` lançaria no jsdom
 * (sem AppRouterContext) — exatamente o guarda que queremos (espelha admin-moderation.test.tsx).
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ReviewQueue } from '@/components/admin/review-queue'

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

const M = ptBR.revisaoImagens
const IMG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RID = '11111111-1111-1111-1111-111111111111'

function oneImage(overrides: Record<string, unknown> = {}) {
  return {
    images: [
      {
        imageId: IMG,
        url: 'https://blob.example/recipes/refined.webp',
        createdAt: '2026-06-18T00:00:00.000Z',
        recipeId: RID,
        recipeTitle: 'Risoto refinado',
        ownerName: 'Dona Cozinha',
        ownerHandle: 'dona-cozinha',
        ...overrides,
      },
    ],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderQueue() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ReviewQueue />
    </LocaleProvider>,
  )
}

describe('ReviewQueue (#227)', () => {
  it('renderiza o card com título, autor e o selo "gerada com refino"', async () => {
    mockFetch({ 'GET /api/curate/review-images': { ok: true, status: 200, body: oneImage() } })
    renderQueue()

    expect(await screen.findByText('Risoto refinado')).toBeInTheDocument()
    expect(screen.getByText('Dona Cozinha')).toBeInTheDocument()
    expect(screen.getByText(M.refinada)).toBeInTheDocument()
    // Link da receita aponta para o caminho canônico /{locale}/recipes/<recipeId>.
    const link = screen.getByRole('link', { name: M.abrirReceita })
    expect(link).toHaveAttribute('href', `/pt-BR/recipes/${RID}`)
  })

  it('remover exige motivo: campo abre, botão desabilitado vazio, POSTa remove e o card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/review-images': { ok: true, status: 200, body: oneImage() },
      [`POST /api/curate/review-images/${IMG}/remove`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.remover }))
    const confirmar = screen.getByRole('button', { name: M.confirmarRemocao })
    expect(confirmar).toBeDisabled()

    await user.type(screen.getByLabelText(M.motivoRemocao), 'imagem imprópria')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/remove'))!
    expect(String(post[0])).toBe(`/api/curate/review-images/${IMG}/remove`)
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ reason: 'imagem imprópria' })
    expect(screen.queryByText('Risoto refinado')).toBeNull() // card some
  })

  it('dispensar: POSTa dismiss SEM corpo e o card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/review-images': { ok: true, status: 200, body: oneImage() },
      [`POST /api/curate/review-images/${IMG}/dismiss`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.dispensar }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/dismiss'))!
    expect(String(post[0])).toBe(`/api/curate/review-images/${IMG}/dismiss`)
    expect((post[1] as RequestInit).method).toBe('POST')
    expect((post[1] as RequestInit).body).toBeUndefined() // dispensar não tem motivo
    expect(screen.queryByText('Risoto refinado')).toBeNull()
  })

  it('400 dados_invalidos na remoção: card VOLTA + mensagem de motivo', async () => {
    mockFetch({
      'GET /api/curate/review-images': { ok: true, status: 200, body: oneImage() },
      [`POST /api/curate/review-images/${IMG}/remove`]: {
        ok: false,
        status: 400,
        body: { error: 'dados_invalidos' },
      },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.remover }))
    await user.type(screen.getByLabelText(M.motivoRemocao), '   x')
    await user.click(screen.getByRole('button', { name: M.confirmarRemocao }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroMotivo)
    expect(screen.getByText('Risoto refinado')).toBeInTheDocument() // voltou
  })

  it('404 not_found na dispensa: card VOLTA + mensagem', async () => {
    mockFetch({
      'GET /api/curate/review-images': { ok: true, status: 200, body: oneImage() },
      [`POST /api/curate/review-images/${IMG}/dismiss`]: {
        ok: false,
        status: 404,
        body: { error: 'not_found' },
      },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.dispensar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroNaoEncontrada)
    expect(screen.getByText('Risoto refinado')).toBeInTheDocument()
  })

  it('sem receita vinculada: mostra fallback (sem link), ações ainda funcionam', async () => {
    mockFetch({
      'GET /api/curate/review-images': {
        ok: true,
        status: 200,
        body: oneImage({ recipeId: null, recipeTitle: null, ownerName: null, ownerHandle: null }),
      },
    })
    renderQueue()
    expect(await screen.findByText(M.semReceita)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: M.abrirReceita })).toBeNull()
    expect(screen.getByRole('button', { name: M.remover })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.dispensar })).toBeInTheDocument()
  })

  it('vazio-neutro: lista vazia → mensagem, sem alert', async () => {
    mockFetch({ 'GET /api/curate/review-images': { ok: true, status: 200, body: { images: [] } } })
    renderQueue()
    expect(await screen.findByText(M.filaVazia)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o card', async () => {
    mockFetch({
      'GET /api/curate/review-images': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: oneImage() },
      ],
    })
    const user = userEvent.setup()
    renderQueue()
    const alert = await screen.findByRole('alert')
    expect(within(alert).queryByText(ptBR.system.error)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('Risoto refinado')).toBeInTheDocument()
  })
})
