import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Painel de SLA de takedown (#412, GAP-7). Teste de COMPONENTE jsdom: `fetch` mockado no shape REAL
 * de `GET /api/admin/takedown-sla`. Cobre loading, lista (com rótulo de nível + idade), ordenação
 * por urgência (overdue no topo), vazio-neutro e erro de carga + retry.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { TakedownSlaSection } from '@/components/admin/takedown-sla-section'

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

const M = ptBR.admin

// Datas back-dated relativas ao "agora" real (o componente usa new Date()).
const daysAgoISO = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

function ticket(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: over.id ?? '11111111-1111-1111-1111-111111111111',
    requestType: over.requestType ?? 'name_removal',
    sourceUrl: over.sourceUrl ?? null,
    displayName: over.displayName ?? 'Autor Externo',
    message: over.message ?? 'pedido de remoção',
    receivedAt: over.receivedAt ?? daysAgoISO(14),
    slaLevel: over.slaLevel ?? 'red',
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <TakedownSlaSection />
    </LocaleProvider>,
  )
}

describe('TakedownSlaSection (#412)', () => {
  it('renderiza um ticket com rótulo de nível e idade', async () => {
    mockFetch({
      'GET /api/admin/takedown-sla': {
        ok: true,
        status: 200,
        body: { tickets: [ticket({ slaLevel: 'overdue', receivedAt: daysAgoISO(16) })] },
      },
    })
    renderSection()
    expect(await screen.findByText(M.slaNivelOverdue)).toBeInTheDocument()
    expect(screen.getByText('Autor Externo')).toBeInTheDocument()
    expect(screen.getByText(M.slaIdadeDias.replace('{dias}', '16'))).toBeInTheDocument()
  })

  it('ordena por urgência: overdue aparece ANTES de yellow no DOM', async () => {
    mockFetch({
      'GET /api/admin/takedown-sla': {
        ok: true,
        status: 200,
        body: {
          tickets: [
            ticket({ id: 'y', slaLevel: 'yellow', displayName: 'Amarelo', receivedAt: daysAgoISO(10) }),
            ticket({ id: 'o', slaLevel: 'overdue', displayName: 'Vencido', receivedAt: daysAgoISO(16) }),
          ],
        },
      },
    })
    renderSection()
    await screen.findByText(M.slaNivelOverdue)
    const html = document.body.innerHTML
    expect(html.indexOf('Vencido')).toBeLessThan(html.indexOf('Amarelo'))
  })

  it('vazio-neutro: lista vazia → mensagem, sem alert', async () => {
    mockFetch({
      'GET /api/admin/takedown-sla': { ok: true, status: 200, body: { tickets: [] } },
    })
    renderSection()
    expect(await screen.findByText(M.slaVazio)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('erro de CARGA + retry: 500 → alert + retry → segundo GET ok exibe o ticket', async () => {
    mockFetch({
      'GET /api/admin/takedown-sla': [
        { ok: false, status: 500, body: { error: 'erro_interno' } },
        { ok: true, status: 200, body: { tickets: [ticket({ displayName: 'Depois do Retry' })] } },
      ],
    })
    const user = userEvent.setup()
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.system.error)
    await user.click(screen.getByRole('button', { name: ptBR.system.retry }))
    expect(await screen.findByText('Depois do Retry')).toBeInTheDocument()
  })
})

describe('TakedownSlaSection — encerrar ticket', () => {
  const RESOLVE = 'POST /api/admin/takedown-sla/resolve'

  function bodyOf(impl: ReturnType<typeof mockFetch>, key: string): unknown {
    const call = impl.mock.calls.find(
      (c) => `${(c[1]?.method ?? 'GET').toUpperCase()} ${String(c[0])}` === key,
    )
    return call ? JSON.parse(String(call[1]?.body)) : undefined
  }

  it('"Marcar como atendido" envia fulfilled e tira o ticket da lista', async () => {
    const impl = mockFetch({
      'GET /api/admin/takedown-sla': {
        ok: true,
        status: 200,
        body: { tickets: [ticket({ displayName: 'Autor A' })] },
      },
      [RESOLVE]: { ok: true, status: 200, body: { status: 'fulfilled' } },
    })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: M.slaMarcarAtendido }))
    expect(await screen.findByText(M.slaVazio)).toBeInTheDocument()
    expect(bodyOf(impl, RESOLVE)).toEqual({
      ticketId: '11111111-1111-1111-1111-111111111111',
      resolution: 'fulfilled',
    })
  })

  it('"Recusar" pede motivo; só confirma com motivo preenchido e envia rejected + motivo', async () => {
    const impl = mockFetch({
      'GET /api/admin/takedown-sla': {
        ok: true,
        status: 200,
        body: { tickets: [ticket({ displayName: 'Autor B' })] },
      },
      [RESOLVE]: { ok: true, status: 200, body: { status: 'rejected' } },
    })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: M.slaRecusar }))
    const confirmar = screen.getByRole('button', { name: M.slaConfirmarRecusa })
    expect(confirmar).toBeDisabled()
    await user.type(screen.getByLabelText(M.slaMotivoLabel), 'não é o autor')
    await user.click(confirmar)
    expect(await screen.findByText(M.slaVazio)).toBeInTheDocument()
    expect(bodyOf(impl, RESOLVE)).toEqual({
      ticketId: '11111111-1111-1111-1111-111111111111',
      resolution: 'rejected',
      reason: 'não é o autor',
    })
  })

  it('erro ao encerrar mantém o ticket e mostra alerta', async () => {
    mockFetch({
      'GET /api/admin/takedown-sla': {
        ok: true,
        status: 200,
        body: { tickets: [ticket({ displayName: 'Autor C' })] },
      },
      [RESOLVE]: { ok: false, status: 500, body: { error: 'erro_interno' } },
    })
    const user = userEvent.setup()
    renderSection()
    await user.click(await screen.findByRole('button', { name: M.slaMarcarAtendido }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.slaEncerrarErro)
    expect(screen.getByText('Autor C')).toBeInTheDocument()
  })
})
