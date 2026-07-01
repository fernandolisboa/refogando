import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET as notificationsGET } from '@/app/api/notifications/route'
import { POST as readPOST } from '@/app/api/notifications/read/route'
import { getDb } from '@/server/deps'
import { notification } from '@/db/schema'
import { emitNotification } from '@/server/notification'
import { seedUser, seedSessionHeaders } from '../helpers/users'

/**
 * Rotas finas da Caixa (#371, ADR-0028): GET `/api/notifications` + POST `/api/notifications/read`.
 * SÓ-logadas (anon→401), `no-store`, viewer da SESSÃO (nunca de query — anti-IDOR), body tolerante.
 */

function getReq(headers?: Headers, query = '') {
  return notificationsGET(
    new Request(`http://localhost/api/notifications${query}`, { headers: headers ?? new Headers() }),
  )
}

function readReq(headers: Headers | undefined, body?: string) {
  return readPOST(
    new Request('http://localhost/api/notifications/read', {
      method: 'POST',
      headers: headers ?? new Headers(),
      body,
    }),
  )
}

describe('GET /api/notifications (#371)', () => {
  it('anônimo → 401', async () => {
    expect((await getReq()).status).toBe(401)
  })

  it('logado → 200, no-store, só as próprias', async () => {
    const actor = await seedUser({ email: 'ga@n.test', name: 'GActor', handle: 'gactor' })
    const { userId, headers } = await seedSessionHeaders({ email: 'gv@n.test' })
    await emitNotification(getDb(), { recipientId: userId, type: 'new_follower', actorId: actor })

    const res = await getReq(headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.unreadCount).toBe(1)
    expect(body.notifications).toHaveLength(1)
    expect(body.notifications[0]).toMatchObject({ type: 'new_follower', refs: { actorName: 'GActor' } })
    // Allowlist: nunca expõe o id do ator nem email/role.
    expect(JSON.stringify(body)).not.toContain(actor)
  })

  it('viewerId vem da SESSÃO, não de ?viewerId= (anti-IDOR)', async () => {
    const other = await seedUser({ email: 'oth@n.test', name: 'Other', handle: 'other-v' })
    const actor = await seedUser({ email: 'oact@n.test', name: 'OAct', handle: 'oact' })
    await emitNotification(getDb(), { recipientId: other, type: 'new_follower', actorId: actor })
    const { headers } = await seedSessionHeaders({ email: 'me@n.test' })
    // Passa o id de OUTRO na query — deve ser ignorado (só a caixa do viewer da sessão, vazia).
    const res = await getReq(headers, `?viewerId=${other}`)
    const body = await res.json()
    expect(body.notifications).toHaveLength(0)
  })
})

describe('POST /api/notifications/read (#371)', () => {
  it('anônimo → 401', async () => {
    expect((await readReq(undefined)).status).toBe(401)
  })

  it('sem body (marca-tudo) → { unreadCount: 0 }, no-store', async () => {
    const actor = await seedUser({ email: 'ract@n.test', name: 'RAct', handle: 'ract' })
    const { userId, headers } = await seedSessionHeaders({ email: 'rv@n.test' })
    await emitNotification(getDb(), { recipientId: userId, type: 'new_follower', actorId: actor })
    const res = await readReq(headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ unreadCount: 0 })
    // De fato marcou lido no banco.
    const [row] = await getDb().select().from(notification).where(eq(notification.recipientId, userId))
    expect(row.readAt).not.toBeNull()
  })

  it('body adulterado (não-JSON / ids não-array) → não 500 (tratado como marca-tudo)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'bad@n.test' })
    expect((await readReq(headers, 'isto não é json {{{')).status).toBe(200)
    expect((await readReq(headers, JSON.stringify({ ids: 'x' }))).status).toBe(200)
    expect((await readReq(headers, JSON.stringify({ ids: [123, null] }))).status).toBe(200)
  })
})
