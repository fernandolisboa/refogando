import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as statusPOST } from '@/app/api/me/following/status/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { follow } from '@/server/user/follow'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * "Eu sigo?" em LOTE (#588) — `POST /api/me/following/status`, contra Postgres real. Cobre: anônimo ⇒ 401
 * sem tocar o DB; só os handles SEGUIDOS voltam (com o handle ARMAZENADO, não o pedido); o próprio viewer
 * volta em `self` e nunca em `following`; conta soft-deletada some (leak-safe); corpo fora da forma / acima
 * do teto ⇒ 400; itens lixo (não-string, vazio, NUL, gigante) são descartados sem 500; sem id na resposta;
 * `no-store`.
 */

function statusReq(body: unknown, headers?: Headers): Promise<Response> {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return statusPOST(
    new Request('http://localhost/api/me/following/status', {
      method: 'POST',
      headers: h,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

async function handleOf(userId: string): Promise<string> {
  const [row] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return row!.handle
}

describe('POST /api/me/following/status (#588)', () => {
  it('anônimo ⇒ 401', async () => {
    const res = await statusReq({ handles: ['alguem'] })
    expect(res.status).toBe(401)
  })

  it('devolve SÓ os seguidos (handle armazenado), o próprio em `self`, nunca id; no-store', async () => {
    const { userId: viewer, headers } = await seedSessionHeaders({ email: 'viewer@status.test' })
    const seguido = await seedUser({ email: 'seguido@status.test', name: 'Seguido', handle: 'seguido-st' })
    await seedUser({ email: 'nao@status.test', name: 'Não', handle: 'nao-seguido-st' })
    await follow(getDb(), viewer, seguido)
    const self = await handleOf(viewer)

    // Pedido com caixa/espaço diferentes: casa pela normalização, volta o handle ARMAZENADO.
    const res = await statusReq(
      { handles: ['  SEGUIDO-ST ', 'nao-seguido-st', 'inexistente-st', self.toUpperCase()] },
      headers,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ following: ['seguido-st'], self })
    expect(JSON.stringify(body)).not.toContain(seguido)
    expect(JSON.stringify(body)).not.toContain(viewer)
  })

  it('self fora do lote ⇒ null; seguido SOFT-DELETADO some (indistinguível de inexistente)', async () => {
    const { userId: viewer, headers } = await seedSessionHeaders({ email: 'viewer2@status.test' })
    const vivo = await seedUser({ email: 'vivo@status.test', name: 'Vivo', handle: 'vivo-st' })
    const morto = await seedUser({ email: 'morto@status.test', name: 'Morto', handle: 'morto-st' })
    await follow(getDb(), viewer, vivo)
    await follow(getDb(), viewer, morto)
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, morto))

    const res = await statusReq({ handles: ['vivo-st', 'morto-st'] }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ following: ['vivo-st'], self: null })
  })

  it('aresta de OUTRO viewer não conta (o estado é do viewer da sessão)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'viewer3@status.test' })
    const outro = await seedUser({ email: 'outro@status.test', name: 'Outro', handle: 'outro-st' })
    const alvo = await seedUser({ email: 'alvo@status.test', name: 'Alvo', handle: 'alvo-st' })
    await follow(getDb(), outro, alvo)

    const res = await statusReq({ handles: ['alvo-st'] }, headers)
    await expect(res.json()).resolves.toEqual({ following: [], self: null })
  })

  it('corpo fora da forma ou acima de 50 handles ⇒ 400 dados_invalidos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'viewer4@status.test' })
    for (const bad of ['{nao-json', { handles: 'a,b' }, {}, null, { handles: Array.from({ length: 51 }, (_, i) => `h${i}`) }]) {
      const res = await statusReq(bad, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    }
    // Exatamente 50 passa (o teto é inclusivo).
    const ok = await statusReq({ handles: Array.from({ length: 50 }, (_, i) => `h${i}`) }, headers)
    expect(ok.status).toBe(200)
  })

  it('itens lixo são DESCARTADOS (sem 500): não-string, vazio, NUL, gigante; lote vazio ⇒ vazio', async () => {
    const { userId: viewer, headers } = await seedSessionHeaders({ email: 'viewer5@status.test' })
    const alvo = await seedUser({ email: 'alvo5@status.test', name: 'Alvo', handle: 'alvo5-st' })
    await follow(getDb(), viewer, alvo)

    const res = await statusReq(
      { handles: [42, null, '', '   ', 'alvo5-st\u0000', 'x'.repeat(5000), { h: 1 }, 'alvo5-st', 'ALVO5-ST'] },
      headers,
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ following: ['alvo5-st'], self: null })

    const empty = await statusReq({ handles: [] }, headers)
    expect(empty.status).toBe(200)
    await expect(empty.json()).resolves.toEqual({ following: [], self: null })
  })
})
