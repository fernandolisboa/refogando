import { describe, expect, it } from 'vitest'
import { GET, PUT } from '@/app/api/admin/config/route'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Config de app (modelo default) — GET/PUT admin-only (T8, #5.AC2). Prova: Usuário e
 * Curador são negados (403); Admin lê/grava; PUT fora da allowlist → 400; PUT válido
 * persiste e um GET subsequente relê o valor (round-trip no singleton app_config).
 */

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/admin/config', { headers }))
}
function put(body: unknown, headers?: Headers): Promise<Response> {
  return PUT(
    new Request('http://localhost/api/admin/config', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

describe('/api/admin/config — modelo default (admin-only)', () => {
  it('Usuário → 403 em GET e PUT', async () => {
    const { headers } = await seedSessionHeaders({ email: 'user@cfg.test', role: 'usuario' })
    expect((await get(headers)).status).toBe(403)
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(403)
  })

  it('Curador → 403 em GET e PUT', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cur@cfg.test', role: 'curador' })
    expect((await get(headers)).status).toBe(403)
    expect((await put({ defaultModel: 'claude-sonnet-4-6' }, headers)).status).toBe(403)
  })

  it('sem sessão → 401 em GET', async () => {
    const res = await get()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('Admin → 200 no GET; default em código quando a linha está ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin@cfg.test', role: 'admin' })
    const res = await get(headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ defaultModel: 'claude-opus-4-8' })
  })

  it('Admin PUT fora da allowlist → 400 modelo_invalido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin2@cfg.test', role: 'admin' })
    const res = await put({ defaultModel: 'gpt-4' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'modelo_invalido' })
  })

  it('Admin PUT sem defaultModel string → 400 modelo_invalido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin3@cfg.test', role: 'admin' })
    expect((await put({}, headers)).status).toBe(400)
    expect((await put({ defaultModel: 123 }, headers)).status).toBe(400)
  })

  it('Admin PUT válido persiste e um GET subsequente relê o novo valor', async () => {
    const { headers } = await seedSessionHeaders({ email: 'admin4@cfg.test', role: 'admin' })

    const putRes = await put({ defaultModel: 'claude-sonnet-4-6' }, headers)
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toEqual({ defaultModel: 'claude-sonnet-4-6' })

    // Round-trip: nova Request de GET relê o singleton persistido.
    const getRes = await get(headers)
    expect(getRes.status).toBe(200)
    await expect(getRes.json()).resolves.toEqual({ defaultModel: 'claude-sonnet-4-6' })
  })
})
