import { describe, expect, it } from 'vitest'
import { POST as curate } from '@/app/api/curate/route'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Gating server-side pela porta mais alta — o handler-sentinela /api/curate (T7, #5.AC1).
 * Prova os degraus: Visitante (sem sessão) → 401; `usuario` → 403; `curador` → 200; e o
 * caso de conta soft-deletada (E5) → 401 conta_desativada (sessão válida, deleted_at
 * mutado PÓS-login pelo helper). `setup.ts` aponta o DI e trunca antes de cada teste.
 */

function post(headers?: Headers): Promise<Response> {
  return curate(new Request('http://localhost/api/curate', { method: 'POST', headers }))
}

describe('POST /api/curate — gating de papel (sentinela)', () => {
  it('sem sessão (Visitante) → 401 nao_autenticado', async () => {
    const res = await post()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('papel usuario → 403 papel_insuficiente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'user@gating.test', role: 'usuario' })
    const res = await post(headers)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({ error: 'papel_insuficiente' })
  })

  it('papel curador → 200 { ok: true }', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador@gating.test', role: 'curador' })
    const res = await post(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('papel admin (⊇ curador) → 200 { ok: true }', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin@gating.test', role: 'admin' })
    const res = await post(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
  })

  it('E5 — conta soft-deletada (sessão válida, deleted_at != null) → 401 conta_desativada', async () => {
    // Helper minta sessão VÁLIDA e DEPOIS faz UPDATE users SET deleted_at=now(): o cookie
    // resolve, mas o gating barra a conta desativada. (cookieCache OFF para não ficar stale.)
    const { headers } = await seedSessionHeaders({
      email: 'apagado@gating.test',
      role: 'curador',
      deletedAt: new Date(),
    })
    const res = await post(headers)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'conta_desativada' })
  })
})
