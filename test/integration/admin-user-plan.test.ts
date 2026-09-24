import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST } from '@/app/api/admin/user-plan/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Conceder/reverter plano de usuário — POST /api/admin/user-plan (Fase 2 #466, admin-only). Prova:
 * gate admin (usuário/curador → 403, anon → 401); conceder `pro` por @handle E por email grava
 * `users.plan`; reverter para `free`; plano inválido → 400; identifier ausente → 400; usuário
 * inexistente → 404. Concessão MANUAL (concierge) — não liga cobrança.
 */

function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/admin/user-plan', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

async function planOf(userId: string): Promise<string> {
  const [row] = await getDb().select({ plan: users.plan }).from(users).where(eq(users.id, userId))
  return row.plan
}

describe('POST /api/admin/user-plan — gate admin', () => {
  it('sem sessão → 401', async () => {
    const res = await post({ identifier: '@x', plan: 'pro' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('Usuário → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'u@plan.test', role: 'usuario' })
    expect((await post({ identifier: '@x', plan: 'pro' }, headers)).status).toBe(403)
  })

  it('Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'c@plan.test', role: 'curador' })
    expect((await post({ identifier: '@x', plan: 'pro' }, headers)).status).toBe(403)
  })
})

describe('POST /api/admin/user-plan — concede/reverte', () => {
  it('concede pro por @handle e grava users.plan; devolve o usuário resolvido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm@plan.test', role: 'admin' })
    const targetId = await seedUser({ email: 'alvo@plan.test', handle: 'chef-alvo', name: 'Alvo' })

    const res = await post({ identifier: '@chef-alvo', plan: 'pro' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      user: { handle: 'chef-alvo', name: 'Alvo', plan: 'pro' },
    })
    expect(await planOf(targetId)).toBe('pro')
  })

  it('concede pro por email (sem @) e grava users.plan', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm2@plan.test', role: 'admin' })
    const targetId = await seedUser({ email: 'poremail@plan.test', handle: 'por-email' })

    const res = await post({ identifier: 'poremail@plan.test', plan: 'pro' }, headers)
    expect(res.status).toBe(200)
    expect(await planOf(targetId)).toBe('pro')
  })

  it('handle SEM @ também resolve', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm3@plan.test', role: 'admin' })
    const targetId = await seedUser({ email: 'semarroba@plan.test', handle: 'sem-arroba' })

    const res = await post({ identifier: 'sem-arroba', plan: 'pro' }, headers)
    expect(res.status).toBe(200)
    expect(await planOf(targetId)).toBe('pro')
  })

  it('reverte pro → free', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm4@plan.test', role: 'admin' })
    const targetId = await seedUser({ email: 'reverte@plan.test', handle: 'reverte' })

    expect((await post({ identifier: '@reverte', plan: 'pro' }, headers)).status).toBe(200)
    expect(await planOf(targetId)).toBe('pro')

    const res = await post({ identifier: '@reverte', plan: 'free' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ user: { plan: 'free' } })
    expect(await planOf(targetId)).toBe('free')
  })
})

describe('POST /api/admin/user-plan — validação', () => {
  it('plano inválido → 400 plano_invalido (não grava)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm5@plan.test', role: 'admin' })
    const targetId = await seedUser({ email: 'naomexe@plan.test', handle: 'nao-mexe' })

    const res = await post({ identifier: '@nao-mexe', plan: 'enterprise' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'plano_invalido' })
    expect(await planOf(targetId)).toBe('free') // inalterado
  })

  it('identifier ausente/vazio → 400 dados_invalidos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm6@plan.test', role: 'admin' })
    expect((await post({ plan: 'pro' }, headers)).status).toBe(400)
    const res = await post({ identifier: '   ', plan: 'pro' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
  })

  it('usuário inexistente → 404 usuario_nao_encontrado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm7@plan.test', role: 'admin' })
    const res = await post({ identifier: '@nao-existe-mesmo', plan: 'pro' }, headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'usuario_nao_encontrado' })
  })
})
