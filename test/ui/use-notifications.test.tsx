import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * `useNotifications` (#371, ADR-0028): pull no mount + UMA busca por volta à aba (`focus` e
 * `visibilitychange` coalescidos via useOnTabReturn). Visitante não busca nem escuta. `useSession` e
 * `fetch` mockados; Date fixo pra controlar a janela de coalescência.
 */

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

import { useNotifications } from '@/components/use-notifications'
import { TAB_RETURN_COALESCE_MS } from '@/components/use-tab-return'

const authed: SessionState = { data: { user: { id: 'u-1' } }, error: null, isPending: false }
const anon: SessionState = { data: null, error: null, isPending: false }

const T0 = new Date(2026, 9, 13, 12, 0, 0).getTime()

function mockFetch() {
  const impl = vi.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ notifications: [], unreadCount: 2, nextCursor: null }),
      }) as Response,
  )
  vi.stubGlobal('fetch', impl)
  return impl
}

const gets = (impl: ReturnType<typeof mockFetch>) =>
  impl.mock.calls.filter((call: unknown[]) => String(call[0]) === '/api/notifications').length

const voltaAba = () => {
  document.dispatchEvent(new Event('visibilitychange'))
  window.dispatchEvent(new Event('focus'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useNotifications — pull por volta à aba (ADR-0028)', () => {
  it('logado: mount busca 1×; volta à aba (visibilitychange + focus) busca +1', async () => {
    sessionState = authed
    const impl = mockFetch()
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.unreadCount).toBe(2))
    expect(gets(impl)).toBe(1)

    voltaAba()
    expect(gets(impl)).toBe(2)
  })

  it('logado: refoco simples (só focus) busca +1', async () => {
    sessionState = authed
    const impl = mockFetch()
    renderHook(() => useNotifications())
    await waitFor(() => expect(gets(impl)).toBe(1))

    window.dispatchEvent(new Event('focus'))
    expect(gets(impl)).toBe(2)
  })

  it('duas voltas separadas por mais que a janela → +2', async () => {
    sessionState = authed
    const impl = mockFetch()
    renderHook(() => useNotifications())
    await waitFor(() => expect(gets(impl)).toBe(1))

    voltaAba()
    vi.setSystemTime(T0 + TAB_RETURN_COALESCE_MS + 1)
    voltaAba()
    expect(gets(impl)).toBe(3)
  })

  it('Visitante: não busca no mount nem na volta à aba (Modelo B)', () => {
    sessionState = anon
    const impl = mockFetch()
    renderHook(() => useNotifications())
    voltaAba()
    expect(impl).not.toHaveBeenCalled()
  })
})
