import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { CookFollowButton } from '@/components/recipe/cook-follow-button'

/**
 * Botão Seguir compacto do trilho (#278) + seam `useFollowToggle`. Semeado por prop (SEM GET-no-mount):
 * otimismo no clique, POST/DELETE, revert no erro. `fetch` mockado por método.
 */

const LABELS = { seguir: 'Seguir', seguindo: 'Seguindo', erroSeguir: 'Deu ruim' }

function mockFetch(handler: (method: string) => { ok: boolean; status?: number; body: unknown }) {
  const impl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const r = handler((init?.method ?? 'GET').toUpperCase())
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CookFollowButton (#278)', () => {
  it('semeado não-seguindo: mostra "Seguir" SEM GET no mount', () => {
    const fetchMock = mockFetch(() => ({ ok: true, body: {} }))
    render(<CookFollowButton handle="chef-ana" labels={LABELS} />)
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled() // nenhum GET-de-estado por item
  })

  it('clicar → POST → "Seguindo"', async () => {
    const fetchMock = mockFetch((method) =>
      method === 'POST' ? { ok: true, body: { isFollowing: true, followerCount: 1 } } : { ok: false, body: {} },
    )
    const user = userEvent.setup()
    render(<CookFollowButton handle="chef-ana" labels={LABELS} />)
    await user.click(screen.getByRole('button', { name: 'Seguir' }))
    expect(await screen.findByRole('button', { name: 'Seguindo' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toContain('/api/u/chef-ana/follow')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
  })

  it('semeado seguindo: clicar → DELETE → "Seguir"', async () => {
    mockFetch((method) =>
      method === 'DELETE' ? { ok: true, body: { isFollowing: false, followerCount: 0 } } : { ok: false, body: {} },
    )
    const user = userEvent.setup()
    render(<CookFollowButton handle="chef-ana" initialFollowing labels={LABELS} />)
    await user.click(screen.getByRole('button', { name: 'Seguindo' }))
    expect(await screen.findByRole('button', { name: 'Seguir' })).toBeInTheDocument()
  })

  it('erro no POST: reverte para "Seguir" e mostra aviso neutro', async () => {
    mockFetch((method) => (method === 'POST' ? { ok: false, status: 500, body: {} } : { ok: false, body: {} }))
    const user = userEvent.setup()
    render(<CookFollowButton handle="chef-ana" labels={LABELS} />)
    await user.click(screen.getByRole('button', { name: 'Seguir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Deu ruim')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Seguir' })).toBeInTheDocument())
  })
})
