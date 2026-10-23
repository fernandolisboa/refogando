import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireFreshRole } from '@/server/auth/guard'

/**
 * `requireFreshRole` (#606): papel ANTES da idade da sessão. Quem não é admin recebe o 403 `papel_insuficiente`,
 * nunca o convite para entrar de novo; admin com sessão de mais de 24 h, 403 `reautenticar`. Só `@/lib/auth` mockado.
 */

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuth: () => ({ api: { getSession } }),
}))

const NOW = new Date('2026-10-23T12:00:00.000Z')
const OLD = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000)

function req(): Request {
  return new Request('http://localhost/api/admin/users/x/erasure', { method: 'POST' })
}

async function status(g: Awaited<ReturnType<typeof requireFreshRole>>): Promise<[number, unknown]> {
  if (g.ok) return [200, null]
  return [g.response.status, await g.response.json()]
}

describe('requireFreshRole (#606)', () => {
  afterEach(() => getSession.mockReset())

  it('sem sessão → 401', async () => {
    getSession.mockResolvedValue(null)
    expect(await status(await requireFreshRole(req(), 'admin', NOW))).toEqual([401, { error: 'nao_autenticado' }])
  })

  it('curador com sessão antiga → 403 papel_insuficiente (o papel vem antes)', async () => {
    getSession.mockResolvedValue({ user: { id: 'c', role: 'curador', deletedAt: null }, session: { createdAt: OLD } })
    expect(await status(await requireFreshRole(req(), 'admin', NOW))).toEqual([403, { error: 'papel_insuficiente' }])
  })

  it('admin com sessão antiga → 403 reautenticar; recente → passa', async () => {
    getSession.mockResolvedValue({ user: { id: 'a', role: 'admin', deletedAt: null }, session: { createdAt: OLD } })
    expect(await status(await requireFreshRole(req(), 'admin', NOW))).toEqual([403, { error: 'reautenticar' }])
    getSession.mockResolvedValue({ user: { id: 'a', role: 'admin', deletedAt: null }, session: { createdAt: NOW } })
    expect((await requireFreshRole(req(), 'admin', NOW)).ok).toBe(true)
  })
})
