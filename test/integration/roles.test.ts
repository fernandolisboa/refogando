import { describe, expect, it } from 'vitest'
import { PUT as setRoleHandler } from '@/app/api/admin/roles/route'
import { POST as curate } from '@/app/api/curate/route'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Promover/rebaixar muda o gating efetivo (T9, #5.AC5). Um `usuario` é 403 em /api/curate;
 * o Admin o promove a `curador` via /api/admin/roles; o MESMO user (mesma sessão, lida de
 * novo — cookieCache OFF) passa a 200. + caso E8: userId inexistente → corpo {error} limpo,
 * sem 500 com stack.
 */

function curatePost(headers: Headers): Promise<Response> {
  return curate(new Request('http://localhost/api/curate', { method: 'POST', headers }))
}
function rolesPut(body: unknown, headers: Headers): Promise<Response> {
  return setRoleHandler(
    new Request('http://localhost/api/admin/roles', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

describe('/api/admin/roles — promover/rebaixar altera o gating', () => {
  it('usuario 403 → admin promove a curador → o MESMO user vira 200 em /api/curate', async () => {
    const target = await seedSessionHeaders({ email: 'alvo@roles.test', role: 'usuario' })
    const adminS = await seedSessionHeaders({ email: 'admin@roles.test', role: 'admin' })

    // Antes: o alvo (usuario) é negado em /api/curate.
    expect((await curatePost(target.headers)).status).toBe(403)

    // Admin promove o alvo a curador.
    const promote = await rolesPut({ userId: target.userId, role: 'curador' }, adminS.headers)
    expect(promote.status).toBe(200)
    await expect(promote.json()).resolves.toEqual({ userId: target.userId, role: 'curador' })

    // Depois: a MESMA sessão do alvo agora passa (o gating leu o papel atualizado).
    const after = await curatePost(target.headers)
    expect(after.status).toBe(200)
    await expect(after.json()).resolves.toEqual({ ok: true })
  })

  it('E8 — userId inexistente → corpo {error} limpo (não 500 com stack)', async () => {
    const adminS = await seedSessionHeaders({ email: 'admin2@roles.test', role: 'admin' })

    const res = await rolesPut(
      { userId: '00000000-0000-0000-0000-000000000000', role: 'curador' },
      adminS.headers,
    )
    // Não vaza 500 com stack: corpo é um {error} controlado.
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('error')
    expect(typeof body.error).toBe('string')
    expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)/) // sem stack frames
    expect(['papel_nao_aplicado', 'erro_interno']).toContain(body.error)
  })

  it('PUT com role inválido → 400 papel_invalido', async () => {
    const adminS = await seedSessionHeaders({ email: 'admin3@roles.test', role: 'admin' })
    const target = await seedSessionHeaders({ email: 'alvo2@roles.test', role: 'usuario' })
    const res = await rolesPut({ userId: target.userId, role: 'rei' }, adminS.headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'papel_invalido' })
  })

  it('não-admin (usuario) não pode chamar /api/admin/roles → 403', async () => {
    const u = await seedSessionHeaders({ email: 'naoadmin@roles.test', role: 'usuario' })
    const target = await seedSessionHeaders({ email: 'alvo3@roles.test', role: 'usuario' })
    const res = await rolesPut({ userId: target.userId, role: 'curador' }, u.headers)
    expect(res.status).toBe(403)
  })
})
