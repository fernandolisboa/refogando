import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { POST as followPOST, DELETE as followDELETE } from '@/app/api/u/[handle]/follow/route'
import { getDb } from '@/server/deps'
import type { Database } from '@/db/client'
import { notification, users } from '@/db/schema'
import {
  emitNotification,
  loadNotifications,
  markRead,
  NOTIFICATIONS_PAGE_SIZE,
} from '@/server/notification'
import { seedUser, seedSessionHeaders } from '../helpers/users'

/**
 * Caixa de Notificações (#371, ADR-0028) contra Postgres real. Cobre: o fio do emit (`new_follower` no
 * seguir, nunca no unfollow; uma por evento), o best-effort, `loadNotifications` (anti-IDOR, contador,
 * cursor lossless, degradação TOTAL do ator soft-deletado) e `markRead` (lote/por-item/uuid-forjado/
 * idempotente/anti-IDOR).
 */

function followReq(method: 'POST' | 'DELETE', handle: string, headers?: Headers) {
  const req = new Request(`http://localhost/api/u/${handle}/follow`, {
    method,
    headers: headers ?? new Headers(),
  })
  const ctx = { params: Promise.resolve({ handle }) }
  return method === 'POST' ? followPOST(req, ctx) : followDELETE(req, ctx)
}

async function handleOf(userId: string): Promise<string> {
  const [row] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return row!.handle
}

async function countNotifs(recipientId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.recipientId, recipientId))
  return rows.length
}

describe('emit new_follower (#371) — fio do seguir', () => {
  it('POST /follow insere UMA notificação (recipient=followee, actor=follower, type=new_follower)', async () => {
    const followee = await seedUser({ email: 'ee@n.test', name: 'Ee', handle: 'ee-notif' })
    const { userId: follower, headers } = await seedSessionHeaders({ email: 'er@n.test' })

    const res = await followReq('POST', 'ee-notif', headers)
    expect(res.status).toBe(200)

    const rows = await getDb().select().from(notification).where(eq(notification.recipientId, followee))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'new_follower', actorId: follower, recipeId: null, reviewId: null })
    expect(rows[0].readAt).toBeNull()
  })

  it('unfollow (DELETE) NÃO emite notificação', async () => {
    const followee = await seedUser({ email: 'ee2@n.test', name: 'Ee2', handle: 'ee2-notif' })
    const { headers } = await seedSessionHeaders({ email: 'er2@n.test' })
    await followReq('POST', 'ee2-notif', headers)
    await followReq('DELETE', 'ee2-notif', headers)
    // Só a do seguir; o unfollow não acrescenta nada.
    expect(await countNotifs(followee)).toBe(1)
  })

  it('re-seguir / double-POST → exatamente UMA notificação (uma por evento, ADR-0028)', async () => {
    const followee = await seedUser({ email: 'ee3@n.test', name: 'Ee3', handle: 'ee3-notif' })
    const { headers } = await seedSessionHeaders({ email: 'er3@n.test' })
    await followReq('POST', 'ee3-notif', headers) // aresta nova → 1
    await followReq('POST', 'ee3-notif', headers) // já segue → no-op, sem 2ª
    expect(await countNotifs(followee)).toBe(1)

    // unfollow + refollow: nova aresta nasce ⇒ nova notificação (evento genuíno), total 2.
    await followReq('DELETE', 'ee3-notif', headers)
    await followReq('POST', 'ee3-notif', headers)
    expect(await countNotifs(followee)).toBe(2)
  })

  it('auto-seguir (422) NÃO emite', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'self@n.test' })
    const h = await handleOf(userId)
    const res = await followReq('POST', h, headers)
    expect(res.status).toBe(422)
    expect(await countNotifs(userId)).toBe(0)
  })
})

describe('emitNotification (#371) — best-effort', () => {
  it('engole falha de insert e NÃO relança (a ação de origem nunca falha)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Stub que rejeita no insert — determinístico (não depende de violação de FK coincidental).
    const brokenDb = {
      insert: () => ({ values: () => Promise.reject(new Error('boom')) }),
    } as unknown as Database
    await expect(
      emitNotification(brokenDb, { recipientId: crypto.randomUUID(), type: 'new_follower' }),
    ).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('loadNotifications (#371) — leitura', () => {
  it('só do próprio recipient (anti-IDOR): viewer B nunca vê a linha de A', async () => {
    const a = await seedUser({ email: 'reca@n.test', name: 'RecA', handle: 'reca' })
    const b = await seedUser({ email: 'recb@n.test', name: 'RecB', handle: 'recb' })
    const actor = await seedUser({ email: 'act@n.test', name: 'Actor', handle: 'act1' })
    await emitNotification(getDb(), { recipientId: a, type: 'new_follower', actorId: actor })

    const pageA = await loadNotifications(getDb(), a)
    expect(pageA.notifications).toHaveLength(1)
    expect(pageA.unreadCount).toBe(1)
    expect(pageA.notifications[0]).toMatchObject({
      type: 'new_follower',
      refs: { actorName: 'Actor', actorHandle: 'act1' },
    })

    const pageB = await loadNotifications(getDb(), b)
    expect(pageB.notifications).toHaveLength(0)
    expect(pageB.unreadCount).toBe(0)
  })

  it('paginação por cursor lossless: probe limit+1, nextCursor, boundary de mesmo created_at', async () => {
    const rec = await seedUser({ email: 'pag@n.test', name: 'Pag', handle: 'pag' })
    const actor = await seedUser({ email: 'pact@n.test', name: 'PActor', handle: 'pact' })
    // 3 linhas com o MESMO created_at (boundary): o desempate por id garante ordem estável sem
    // repetir/omitir na virada de página.
    const ts = new Date('2026-01-01T00:00:00.000Z')
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const [row] = await getDb()
        .insert(notification)
        .values({ recipientId: rec, type: 'new_follower', actorId: actor, createdAt: ts })
        .returning({ id: notification.id })
      ids.push(row.id)
    }
    const p1 = await loadNotifications(getDb(), rec, { limit: 2 })
    expect(p1.notifications).toHaveLength(2)
    expect(p1.nextCursor).not.toBeNull()
    const p2 = await loadNotifications(getDb(), rec, { limit: 2, cursor: p1.nextCursor })
    expect(p2.notifications).toHaveLength(1)
    expect(p2.nextCursor).toBeNull()
    // As 3 linhas, sem repetição nem omissão no boundary de created_at igual.
    const seen = [...p1.notifications, ...p2.notifications].map((n) => n.id)
    expect(new Set(seen).size).toBe(3)
    expect(seen.sort()).toEqual([...ids].sort())
  })

  it('default page size = NOTIFICATIONS_PAGE_SIZE', () => {
    expect(NOTIFICATIONS_PAGE_SIZE).toBe(20)
  })

  it('degradação TOTAL: ator soft-deletado → actorName/actorHandle/actorImage TODOS null, linha PERMANECE', async () => {
    const rec = await seedUser({ email: 'deg@n.test', name: 'Deg', handle: 'deg' })
    const actor = await seedUser({
      email: 'gone@n.test',
      name: 'Gone',
      handle: 'gone-actor',
    })
    await getDb().update(users).set({ image: 'https://img.test/a.png' }).where(eq(users.id, actor))
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })

    // vivo: identidade presente
    const alive = await loadNotifications(getDb(), rec)
    expect(alive.notifications[0]).toMatchObject({
      refs: { actorName: 'Gone', actorHandle: 'gone-actor' },
      actorImage: 'https://img.test/a.png',
    })

    // soft-delete do ator → identidade COLAPSA junta, mas a notificação NÃO some.
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, actor))
    const degraded = await loadNotifications(getDb(), rec)
    expect(degraded.notifications).toHaveLength(1)
    expect(degraded.notifications[0].refs.actorName).toBeNull()
    expect(degraded.notifications[0].refs.actorHandle).toBeNull()
    expect(degraded.notifications[0].actorImage).toBeNull()
  })
})

describe('markRead (#371)', () => {
  it('marca-tudo (ids ausente) zera o contador; idempotente', async () => {
    const rec = await seedUser({ email: 'mr1@n.test', name: 'Mr1', handle: 'mr1' })
    const actor = await seedUser({ email: 'mra@n.test', name: 'MrA', handle: 'mra' })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })
    expect((await loadNotifications(getDb(), rec)).unreadCount).toBe(2)

    expect((await markRead(getDb(), rec)).unreadCount).toBe(0)
    expect((await markRead(getDb(), rec)).unreadCount).toBe(0) // idempotente
  })

  it('por-id marca só a indicada; as outras seguem não-lidas', async () => {
    const rec = await seedUser({ email: 'mr2@n.test', name: 'Mr2', handle: 'mr2' })
    const actor = await seedUser({ email: 'mra2@n.test', name: 'MrA2', handle: 'mra2' })
    const [a] = await getDb()
      .insert(notification)
      .values({ recipientId: rec, type: 'new_follower', actorId: actor })
      .returning({ id: notification.id })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })

    const r = await markRead(getDb(), rec, { ids: [a.id] })
    expect(r.unreadCount).toBe(1)
  })

  it('ids com UUID forjado/inválido → sem 500; filtrado-vazio é NO-OP (nunca marca-tudo)', async () => {
    const rec = await seedUser({ email: 'mr3@n.test', name: 'Mr3', handle: 'mr3' })
    const actor = await seedUser({ email: 'mra3@n.test', name: 'MrA3', handle: 'mra3' })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })
    // `ids` presente mas só lixo → NO-OP: o contador NÃO cai (não vira marca-tudo).
    const r = await markRead(getDb(), rec, { ids: ["not-a-uuid", "1; drop table", ""] })
    expect(r.unreadCount).toBe(1)
  })

  it('anti-IDOR: B não marca a notificação de A', async () => {
    const a = await seedUser({ email: 'mia@n.test', name: 'MiA', handle: 'mia' })
    const b = await seedUser({ email: 'mib@n.test', name: 'MiB', handle: 'mib' })
    const actor = await seedUser({ email: 'miact@n.test', name: 'MiAct', handle: 'miact' })
    const [n] = await getDb()
      .insert(notification)
      .values({ recipientId: a, type: 'new_follower', actorId: actor })
      .returning({ id: notification.id })
    // B tenta marcar a linha de A pelo id → não afeta (WHERE recipient_id = B).
    await markRead(getDb(), b, { ids: [n.id] })
    const stillUnread = await getDb()
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.recipientId, a), eq(notification.id, n.id)))
    expect((await loadNotifications(getDb(), a)).unreadCount).toBe(1)
    expect(stillUnread).toHaveLength(1)
  })
})
