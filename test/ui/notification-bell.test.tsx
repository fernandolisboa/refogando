import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Sininho de Notificações (#371, ADR-0028) — SÓ-logado (Modelo B: null no anon/pendente), badge de
 * não-lidas, painel com a lista localizada, e marca-tudo ao abrir. `useSession` e `fetch` mockados.
 */

type SessionData = { user: { id: string } } | null
const fakeSession = (over: Partial<{ data: SessionData; error: unknown; isPending: boolean }> = {}) => ({
  data: null as SessionData,
  error: null as unknown,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
  ...over,
})
let mockSession = fakeSession()
vi.mock('@/lib/auth-client', () => ({ useSession: () => mockSession }))

import { LocaleProvider } from '@/i18n/provider'
import { NotificationBell } from '@/components/notification-bell'
import { ptBR } from '@/i18n/messages/pt-BR'

const authed = () => fakeSession({ data: { user: { id: 'u1' } } })

type MockPage = { notifications: unknown[]; unreadCount: number; nextCursor: string | null }

/** Mocka o fetch: GET /api/notifications → `page`; POST /read → { unreadCount: 0 }. */
function mockFetch(page: MockPage) {
  const readSpy = vi.fn()
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/api/notifications/read')) {
      readSpy(method)
      return { ok: true, status: 200, json: async () => ({ unreadCount: 0 }) } as Response
    }
    return { ok: true, status: 200, json: async () => page } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, readSpy }
}

function renderBell() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <NotificationBell />
    </LocaleProvider>,
  )
}

const M = ptBR.notifications

beforeEach(() => {
  mockSession = fakeSession()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('NotificationBell (#371)', () => {
  it('anônimo → não renderiza nada (Modelo B)', () => {
    mockSession = fakeSession()
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    const { container } = renderBell()
    expect(container).toBeEmptyDOMElement()
  })

  it('pendente → não renderiza nada', () => {
    mockSession = fakeSession({ isPending: true })
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    const { container } = renderBell()
    expect(container).toBeEmptyDOMElement()
  })

  it('logado → sininho com aria-label + badge de não-lidas', async () => {
    mockSession = authed()
    mockFetch({
      notifications: [
        { id: 'n1', type: 'new_follower', refs: { actorName: 'Ana' }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    const bell = screen.getByRole('button', { name: M.ariaLabel })
    expect(bell).toBeInTheDocument()
    // badge aparece após o pull de mount
    expect(await screen.findByText('1')).toBeInTheDocument()
  })

  it('abrir o painel: marca-tudo (POST read), zera o badge e mostra a lista localizada', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    const { readSpy } = mockFetch({
      notifications: [
        { id: 'n1', type: 'new_follower', refs: { actorName: 'Ana' }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    const bell = screen.getByRole('button', { name: M.ariaLabel })
    await screen.findByText('1') // badge presente antes de abrir

    await user.click(bell)
    // O texto localizado do evento aparece no painel portaleado.
    expect(await screen.findByText('Ana começou a seguir você')).toBeInTheDocument()
    // Marca-tudo disparou (POST sem body) e o badge sumiu.
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith('POST'))
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
  })

  it('sem notificações: painel mostra o estado vazio', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    renderBell()
    const bell = screen.getByRole('button', { name: M.ariaLabel })
    await user.click(bell)
    expect(await screen.findByText(M.vazio)).toBeInTheDocument()
  })
})
