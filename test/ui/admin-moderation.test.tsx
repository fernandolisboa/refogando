import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Fila de moderação (#63, AC4). Teste de COMPONENTE jsdom (seam #54): `fetch` mockado no
 * shape REAL de `GET /api/curate/reports` + `POST .../{keep,remove}`. `createdAt` chega como
 * STRING ISO (passou por `res.json()`); valor de `origin` é REAL (`'ai_chat'`, NÃO
 * `'community'`). Cobre: render do card com RÓTULOS localizados (não token cru), remover com
 * motivo obrigatório (payload + card some), 409 reverte, 400 reverte, manter SEM mockar
 * next/navigation (trava "sem router.refresh"), vazio-neutro, e carga-falha + retry.
 *
 * IMPORTANTE: este arquivo NÃO mocka next/navigation. As ações mudam só estado local; se
 * alguém adicionar `router.refresh()`, o render lança no jsdom (sem AppRouterContext) e os
 * testes quebram — exatamente o guarda que queremos.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { ModerationQueue } from '@/components/admin/moderation-queue'

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

const M = ptBR.moderacao
const RID = '11111111-1111-1111-1111-111111111111'

function oneReport() {
  return {
    reports: [
      {
        id: 'r1',
        recipeId: RID,
        reason: 'conteúdo impróprio',
        origin: 'ai_chat',
        resultKind: 'success',
        reporterId: 'u1',
        status: 'pending',
        createdAt: '2026-06-18T00:00:00.000Z',
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
      <ModerationQueue />
    </LocaleProvider>,
  )
}

describe('ModerationQueue (#63 AC4)', () => {
  it('renderiza o card com RÓTULOS localizados (não token cru)', async () => {
    mockFetch({ 'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() } })
    renderQueue()

    expect(await screen.findByText('conteúdo impróprio')).toBeInTheDocument()
    expect(screen.getByText(M.origemAiChat)).toBeInTheDocument() // "Conversa com IA"
    expect(screen.queryByText('ai_chat')).toBeNull() // token cru NÃO aparece
    expect(screen.getByText(M.tipoSucesso)).toBeInTheDocument()
    expect(screen.getByText(M.statusPendente)).toBeInTheDocument()
  })

  it('remover exige motivo: campo abre, botão desabilitado vazio, envia e some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() },
      [`POST /api/curate/reports/r1/remove`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.remover }))
    const confirmar = screen.getByRole('button', { name: M.confirmarRemocao })
    expect(confirmar).toBeDisabled()

    const textarea = screen.getByLabelText(M.motivoRemocao)
    await user.type(textarea, 'spam')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/remove'))!
    expect(String(post[0])).toBe('/api/curate/reports/r1/remove')
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ reason: 'spam' })
    expect(screen.queryByText('conteúdo impróprio')).toBeNull() // card some
  })

  it('409 ja_resolvido na remoção: card VOLTA + mensagem', async () => {
    mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() },
      [`POST /api/curate/reports/r1/remove`]: {
        ok: false,
        status: 409,
        body: { error: 'ja_resolvido' },
      },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.remover }))
    await user.type(screen.getByLabelText(M.motivoRemocao), 'spam')
    await user.click(screen.getByRole('button', { name: M.confirmarRemocao }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroJaResolvido)
    expect(screen.getByText('conteúdo impróprio')).toBeInTheDocument() // voltou
  })

  it('400 dados_invalidos na remoção: card volta + mensagem de motivo', async () => {
    mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() },
      [`POST /api/curate/reports/r1/remove`]: {
        ok: false,
        status: 400,
        body: { error: 'dados_invalidos' },
      },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.remover }))
    await user.type(screen.getByLabelText(M.motivoRemocao), '   x') // não-vazio na UI
    await user.click(screen.getByRole('button', { name: M.confirmarRemocao }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroMotivo)
    expect(screen.getByText('conteúdo impróprio')).toBeInTheDocument()
  })

  it('remover só a imagem (#133): mesmo motivo, POST remove-image, card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() },
      [`POST /api/curate/reports/r1/remove-image`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.remover }))
    const removerImagem = screen.getByRole('button', { name: M.removerImagem })
    expect(removerImagem).toBeDisabled() // motivo OBRIGATÓRIO também na imagem

    await user.type(screen.getByLabelText(M.motivoRemocao), 'foto imprópria')
    expect(removerImagem).toBeEnabled()
    await user.click(removerImagem)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/remove-image'))!
    expect(String(post[0])).toBe('/api/curate/reports/r1/remove-image')
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ reason: 'foto imprópria' })
    expect(screen.queryByText('conteúdo impróprio')).toBeNull() // report resolvido ⇒ card some
  })

  it('422 sem_imagem na remoção de imagem: card VOLTA + mensagem específica', async () => {
    mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() },
      [`POST /api/curate/reports/r1/remove-image`]: {
        ok: false,
        status: 422,
        body: { error: 'sem_imagem' },
      },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.remover }))
    await user.type(screen.getByLabelText(M.motivoRemocao), 'foto')
    await user.click(screen.getByRole('button', { name: M.removerImagem }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroSemImagem)
    expect(screen.getByText('conteúdo impróprio')).toBeInTheDocument() // voltou
  })

  it('manter no pool: POST keep, card some por ESTADO LOCAL (sem router.refresh)', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() },
      [`POST /api/curate/reports/r1/keep`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.manter }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/keep'))!
    expect(String(post[0])).toBe('/api/curate/reports/r1/keep')
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(screen.queryByText('conteúdo impróprio')).toBeNull()
  })

  it('vazio-neutro: lista vazia → mensagem, sem alert', async () => {
    mockFetch({ 'GET /api/curate/reports': { ok: true, status: 200, body: { reports: [] } } })
    renderQueue()
    expect(await screen.findByText(M.filaVazia)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o card', async () => {
    mockFetch({
      'GET /api/curate/reports': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: oneReport() },
      ],
    })
    const user = userEvent.setup()
    renderQueue()
    const alert = await screen.findByRole('alert')
    expect(within(alert).queryByText(ptBR.system.error)).not.toBeNull()
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('conteúdo impróprio')).toBeInTheDocument()
  })
})
