import { afterEach, describe, expect, it, vi } from 'vitest'
import { requireRole } from '@/server/auth/guard'

/**
 * Regressão fail-closed do `requireRole` (#51) — papel `null`/desconhecido NUNCA passa.
 *
 * O bug: `requireRole` barrava só quando `decideRole(...) === 'forbidden'`, mas um papel
 * `null`/desconhecido faz `decideRole` devolver `unauthenticated` (não `forbidden`), então
 * a sessão de papel desconhecido PASSAVA pelo guard curador-only (fail-OPEN). Como o `role`
 * é pgEnum, o caso só surge quando `toSession` normaliza um `role` fora de `ROLES` para
 * `null` (shape de cookieCache/plugin admin, ou uma fonte futura não-pgEnum) — por isso o
 * teste mocka `getSession` para entregar um papel cru NÃO-enum (latente no schema atual).
 *
 * Mockamos só `@/lib/auth` (sem DB/Better Auth real): `requireSession` já tratou ausência
 * de sessão (401); o que validamos aqui é que um usuário AUTENTICADO com papel
 * `null`/desconhecido vira 403, jamais `allow`. Pura unidade do guard (a porta que estava
 * errada — `decideRole` já estava correto).
 */

const getSession = vi.fn()
vi.mock('@/lib/auth', () => ({
  getAuth: () => ({ api: { getSession } }),
}))

function req(): Request {
  return new Request('http://localhost/api/curate', { method: 'POST' })
}

describe('requireRole — fail-closed para papel null/desconhecido (#51)', () => {
  afterEach(() => {
    getSession.mockReset()
  })

  it('papel desconhecido (fora de ROLES) → 403 papel_insuficiente, NÃO passa', async () => {
    // Papel cru NÃO-enum: `toSession` normaliza para null; o bug deixava isso passar.
    getSession.mockResolvedValue({
      user: { id: crypto.randomUUID(), role: 'superusuario', deletedAt: null },
    })
    const g = await requireRole(req(), 'curador')
    expect(g.ok).toBe(false)
    if (g.ok) throw new Error('inalcançável')
    expect(g.response.status).toBe(403)
    await expect(g.response.json()).resolves.toMatchObject({ error: 'papel_insuficiente' })
  })

  it('papel null/ausente (autenticado sem papel reconhecível) → 403, NÃO passa', async () => {
    getSession.mockResolvedValue({ user: { id: crypto.randomUUID(), role: null, deletedAt: null } })
    const g = await requireRole(req(), 'curador')
    expect(g.ok).toBe(false)
    if (g.ok) throw new Error('inalcançável')
    expect(g.response.status).toBe(403)
  })

  it('papel suficiente (curador) → passa (não regrediu o caminho feliz)', async () => {
    getSession.mockResolvedValue({
      user: { id: crypto.randomUUID(), role: 'curador', deletedAt: null },
    })
    const g = await requireRole(req(), 'curador')
    expect(g.ok).toBe(true)
  })
})
