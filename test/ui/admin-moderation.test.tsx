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

const OWNER = '99999999-9999-9999-9999-999999999999'

/** Report SEM dono (Catálogo) — #226: nenhuma ação de bloquear-geração. */
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
        ownerId: null,
        ownerImageGenBlocked: false,
      },
    ],
  }
}

/** #226: report COM dono (comunidade) — habilita a ação de bloquear/desbloquear o autor. */
function ownedReport(ownerImageGenBlocked = false) {
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
        ownerId: OWNER,
        ownerImageGenBlocked,
      },
    ],
  }
}

/** #366: report de uma AVALIAÇÃO — a fila carrega o conteúdo (nota+comentário+autor) pro Curador julgar. */
function reviewReport() {
  return {
    reports: [
      {
        id: 'r1',
        target: 'review',
        reason: 'comentário ofensivo',
        reporterId: 'u1',
        status: 'pending',
        createdAt: '2026-06-18T00:00:00.000Z',
        review: {
          id: 'rev-1',
          recipeId: RID,
          rating: 2,
          comment: 'texto abusivo da avaliação',
          authorName: 'Ana',
          authorHandle: 'ana',
        },
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

  // ── #226: bloquear/desbloquear a geração-de-imagem-por-IA do AUTOR ────────────────────
  it('#226 Catálogo (sem dono): NENHUMA ação de bloquear/desbloquear o autor', async () => {
    mockFetch({ 'GET /api/curate/reports': { ok: true, status: 200, body: oneReport() } })
    renderQueue()
    await screen.findByText('conteúdo impróprio')
    expect(screen.queryByRole('button', { name: M.bloquearGeracao })).toBeNull()
    expect(screen.queryByRole('button', { name: M.desbloquearGeracao })).toBeNull()
  })

  it('#226 com dono não-bloqueado: "Bloquear" exige motivo, POSTa { blocked, reason }, alterna p/ "Desbloquear"', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: ownedReport(false) },
      [`POST /api/curate/users/${OWNER}/image-gen-restriction`]: {
        ok: true,
        status: 200,
        body: { ok: true },
      },
    })
    const user = userEvent.setup()
    renderQueue()

    // Revela o painel de motivo do bloqueio.
    await user.click(await screen.findByRole('button', { name: M.bloquearGeracao }))
    // O confirmar (rótulo distinto, dentro do painel) começa desabilitado sem motivo.
    const confirmar = screen.getByRole('button', { name: M.confirmarBloqueio })
    expect(confirmar).toBeDisabled()

    await user.type(screen.getByLabelText(M.motivoBloqueioGeracao), 'gerou imagem abusiva repetidas vezes')
    // Agora o confirmar habilita; clica.
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/image-gen-restriction'))!
    expect(String(post[0])).toBe(`/api/curate/users/${OWNER}/image-gen-restriction`)
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      blocked: true,
      reason: 'gerou imagem abusiva repetidas vezes',
    })
    // O rótulo alterna para "Desbloquear" (override local pós-sucesso) e o card NÃO some.
    expect(await screen.findByRole('button', { name: M.desbloquearGeracao })).toBeInTheDocument()
    expect(screen.getByText('conteúdo impróprio')).toBeInTheDocument()
  })

  it('#226 com dono bloqueado: "Desbloquear" POSTa { blocked:false } SEM motivo, alterna p/ "Bloquear"', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: ownedReport(true) },
      [`POST /api/curate/users/${OWNER}/image-gen-restriction`]: {
        ok: true,
        status: 200,
        body: { ok: true },
      },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.desbloquearGeracao }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/image-gen-restriction'))!
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ blocked: false })
    expect(await screen.findByRole('button', { name: M.bloquearGeracao })).toBeInTheDocument()
  })

  it('#226 404 not_found no bloqueio: mensagem de autor-não-encontrado; rótulo NÃO alterna', async () => {
    mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: ownedReport(false) },
      [`POST /api/curate/users/${OWNER}/image-gen-restriction`]: {
        ok: false,
        status: 404,
        body: { error: 'not_found' },
      },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.bloquearGeracao }))
    await user.type(screen.getByLabelText(M.motivoBloqueioGeracao), 'motivo')
    await user.click(screen.getByRole('button', { name: M.confirmarBloqueio }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroUsuarioNaoEncontrado)
    // Falhou ⇒ continua não-bloqueado (não virou "Desbloquear").
    expect(screen.queryByRole('button', { name: M.desbloquearGeracao })).toBeNull()
  })

  // ── #366: card de report de uma AVALIAÇÃO ─────────────────────────────────────────
  it('#366 card de avaliação: mostra conteúdo (nota+comentário+autor) + "Manter" + "Remover avaliação"', async () => {
    mockFetch({ 'GET /api/curate/reports': { ok: true, status: 200, body: reviewReport() } })
    renderQueue()

    expect(await screen.findByText('texto abusivo da avaliação')).toBeInTheDocument()
    expect(screen.getByText('comentário ofensivo')).toBeInTheDocument() // motivo do report
    expect(screen.getByRole('button', { name: M.manter })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.removerAvaliacao })).toBeInTheDocument()
    // NÃO há ações de receita nesse card (remover-do-pool / remover-só-imagem não se aplicam).
    expect(screen.queryByRole('button', { name: M.remover })).toBeNull()
    expect(screen.queryByRole('button', { name: M.removerImagem })).toBeNull()
  })

  it('#366 remover avaliação: motivo obrigatório, POST remove-review, card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: reviewReport() },
      [`POST /api/curate/reports/r1/remove-review`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()

    await user.click(await screen.findByRole('button', { name: M.removerAvaliacao }))
    const confirmar = screen.getByRole('button', { name: M.confirmarRemocao })
    expect(confirmar).toBeDisabled() // motivo OBRIGATÓRIO
    await user.type(screen.getByLabelText(M.motivoRemocao), 'viola diretrizes')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/remove-review'))!
    expect(String(post[0])).toBe('/api/curate/reports/r1/remove-review')
    expect((post[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ reason: 'viola diretrizes' })
    expect(screen.queryByText('texto abusivo da avaliação')).toBeNull() // card some
  })

  it('#366 422 sem_avaliacao ao remover avaliação: card VOLTA + mensagem específica', async () => {
    mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: reviewReport() },
      [`POST /api/curate/reports/r1/remove-review`]: {
        ok: false,
        status: 422,
        body: { error: 'sem_avaliacao' },
      },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.removerAvaliacao }))
    await user.type(screen.getByLabelText(M.motivoRemocao), 'x')
    await user.click(screen.getByRole('button', { name: M.confirmarRemocao }))

    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroSemAvaliacao)
    expect(screen.getByText('texto abusivo da avaliação')).toBeInTheDocument() // voltou
  })

  it('#366 manter (keep) num report de avaliação: POST keep, card some', async () => {
    const fetchMock = mockFetch({
      'GET /api/curate/reports': { ok: true, status: 200, body: reviewReport() },
      [`POST /api/curate/reports/r1/keep`]: { ok: true, status: 200, body: { ok: true } },
    })
    const user = userEvent.setup()
    renderQueue()
    await user.click(await screen.findByRole('button', { name: M.manter }))

    const post = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/keep'))!
    expect(String(post[0])).toBe('/api/curate/reports/r1/keep')
    expect(screen.queryByText('texto abusivo da avaliação')).toBeNull()
  })
})
