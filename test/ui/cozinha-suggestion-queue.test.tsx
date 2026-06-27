import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Fila de cozinhas sugeridas (#320). Teste de COMPONENTE jsdom: `fetch` mockado no shape REAL de
 * `GET /api/curate/cozinhas` + `POST .../[slug]/{approve,merge,reject}`. Cobre: render do card com
 * slug CRU + recipeCount; aprovar com rótulos obrigatórios (payload + card some); slug canônico
 * opcional vai no payload; 409 slug_em_uso reverte com mensagem específica; mesclar com alvo; rejeitar
 * imediato; vazio-neutro; carga-falha + retry.
 *
 * Como ModerationQueue, NÃO mocka next/navigation: se alguém adicionar router.refresh() o render lança.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CozinhaSuggestionQueue } from '@/components/admin/cozinha-suggestion-queue'

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

const M = ptBR.filaCozinhas

function oneSuggestion() {
  return { cozinhas: [{ slug: 'georgiana', recipeCount: 3 }] }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderQueue() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaSuggestionQueue />
    </LocaleProvider>,
  )
}

describe('CozinhaSuggestionQueue (#320)', () => {
  it('renderiza o card com o slug CRU sugerido + recipeCount', async () => {
    mockFetch({ 'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() } })
    renderQueue()
    expect(await screen.findByText('georgiana')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('aprovar exige os dois rótulos; envia payload e o card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/approve': { ok: true, status: 200, body: { ok: true, slug: 'georgiana' } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.aprovar }))
    const confirmar = screen.getByRole('button', { name: M.confirmarAprovacao })
    expect(confirmar).toBeDisabled() // sem rótulos

    await user.type(screen.getByLabelText(M.rotuloPtBr), 'Georgiana')
    expect(confirmar).toBeDisabled() // falta o en-US
    await user.type(screen.getByLabelText(M.rotuloEnUs), 'Georgian')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/approve'))!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      labelPtBr: 'Georgiana',
      labelEnUs: 'Georgian',
    })
    expect(screen.queryByText('georgiana')).toBeNull() // card some
  })

  it('aprovar com slug canônico opcional inclui newSlug no payload', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/approve': { ok: true, status: 200, body: { ok: true, slug: 'georgiano' } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.aprovar }))
    await user.type(screen.getByLabelText(M.rotuloPtBr), 'Georgiana')
    await user.type(screen.getByLabelText(M.rotuloEnUs), 'Georgian')
    await user.type(screen.getByLabelText(M.slugCanonico), 'georgiano')
    await user.click(screen.getByRole('button', { name: M.confirmarAprovacao }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/approve'))!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      labelPtBr: 'Georgiana',
      labelEnUs: 'Georgian',
      newSlug: 'georgiano',
    })
  })

  it('409 slug_em_uso na aprovação: card VOLTA + mensagem específica', async () => {
    mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/approve': { ok: false, status: 409, body: { error: 'slug_em_uso' } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.aprovar }))
    await user.type(screen.getByLabelText(M.rotuloPtBr), 'Georgiana')
    await user.type(screen.getByLabelText(M.rotuloEnUs), 'Georgian')
    await user.type(screen.getByLabelText(M.slugCanonico), 'italiana')
    await user.click(screen.getByRole('button', { name: M.confirmarAprovacao }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroSlugEmUso)
    expect(screen.getByText('georgiana')).toBeInTheDocument() // voltou
  })

  it('mesclar: alvo obrigatório, POST merge com { target }, card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/merge': { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.mesclar }))
    const confirmar = screen.getByRole('button', { name: M.confirmarMesclagem })
    expect(confirmar).toBeDisabled()
    await user.type(screen.getByLabelText(M.alvoMesclar), 'italiana')
    await user.click(confirmar)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/merge'))!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ target: 'italiana' })
    expect(screen.queryByText('georgiana')).toBeNull()
  })

  it('400 alvo_invalido na mesclagem: card volta + mensagem', async () => {
    mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/merge': { ok: false, status: 400, body: { error: 'alvo_invalido' } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.mesclar }))
    await user.type(screen.getByLabelText(M.alvoMesclar), 'naoexiste')
    await user.click(screen.getByRole('button', { name: M.confirmarMesclagem }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroAlvoInvalido)
    expect(screen.getByText('georgiana')).toBeInTheDocument()
  })

  it('rejeitar: POST reject imediato (sem painel), card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/reject': { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.rejeitar }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/reject'))!
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(screen.queryByText('georgiana')).toBeNull()
  })

  it('409 ja_resolvido na rejeição: card volta + mensagem', async () => {
    mockFetch({
      'GET /api/curate/cozinhas': { ok: true, status: 200, body: oneSuggestion() },
      'POST /api/curate/cozinhas/georgiana/reject': { ok: false, status: 409, body: { error: 'ja_resolvido' } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.rejeitar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroJaResolvido)
    expect(screen.getByText('georgiana')).toBeInTheDocument()
  })

  it('vazio-neutro: lista vazia → mensagem, sem alert', async () => {
    mockFetch({ 'GET /api/curate/cozinhas': { ok: true, status: 200, body: { cozinhas: [] } } })
    renderQueue()
    expect(await screen.findByText(M.filaVazia)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o card', async () => {
    mockFetch({
      'GET /api/curate/cozinhas': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: oneSuggestion() },
      ],
    })
    const user = userEvent.setup()
    renderQueue()
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('georgiana')).toBeInTheDocument()
  })
})
