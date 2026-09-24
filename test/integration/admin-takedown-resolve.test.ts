import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { POST } from '@/app/api/admin/takedown-sla/resolve/route'
import { getDb } from '@/server/deps'
import { dsarAuditEvent, takedownTicket } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Encerramento de ticket de takedown pela porta real (POST /api/admin/takedown-sla/resolve).
 * ADMIN-ONLY. Prova: status muda + evento de auditoria na mesma operação (FULFILLED com hash /
 * REJECTED com motivo, `caseId` = ticket); 2º encerramento → 409 sem novo evento; 404/400.
 */

async function openTicket(): Promise<string> {
  const [row] = await getDb()
    .insert(takedownTicket)
    .values({
      requestType: 'name_removal',
      displayName: 'Autor Externo',
      sourceUrl: 'https://exemplo.com/receita',
      message: 'tire meu nome',
    })
    .returning({ id: takedownTicket.id })
  return row.id
}

function call(body: unknown, headers?: Headers): Promise<Response> {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return POST(
    new Request('http://localhost/api/admin/takedown-sla/resolve', {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    }),
  )
}

async function eventsFor(caseId: string) {
  return getDb().select().from(dsarAuditEvent).where(eq(dsarAuditEvent.caseId, caseId))
}

async function statusOf(id: string): Promise<string> {
  const [row] = await getDb()
    .select({ status: takedownTicket.status })
    .from(takedownTicket)
    .where(eq(takedownTicket.id, id))
  return row.status
}

describe('POST /api/admin/takedown-sla/resolve — gate de papel', () => {
  it('anônimo → 401; usuário comum → 403', async () => {
    const id = await openTicket()
    expect((await call({ ticketId: id, resolution: 'fulfilled' })).status).toBe(401)
    const { headers } = await seedSessionHeaders({ email: 'u@resolve.test', role: 'usuario' })
    expect((await call({ ticketId: id, resolution: 'fulfilled' }, headers)).status).toBe(403)
    expect(await statusOf(id)).toBe('received')
  })
})

describe('POST /api/admin/takedown-sla/resolve — admin', () => {
  it('fulfilled: status muda e grava DSAR_FULFILLED com hash e caseId', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm1@resolve.test', role: 'admin' })
    const id = await openTicket()
    const res = await call({ ticketId: id, resolution: 'fulfilled' }, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'fulfilled' })
    expect(await statusOf(id)).toBe('fulfilled')
    const evs = await eventsFor(id)
    expect(evs).toHaveLength(1)
    expect(evs[0].eventType).toBe('DSAR_FULFILLED')
    expect(evs[0].payloadHash).toMatch(/^[0-9a-f]{64}$/)
    // Minimização: nada do titular em claro na auditoria.
    expect(JSON.stringify(evs[0])).not.toContain('Autor Externo')
  })

  it('rejected: exige motivo (400 sem ele) e grava DSAR_REJECTED com o motivo', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm2@resolve.test', role: 'admin' })
    const id = await openTicket()
    expect((await call({ ticketId: id, resolution: 'rejected' }, headers)).status).toBe(400)
    const res = await call(
      { ticketId: id, resolution: 'rejected', reason: 'não comprovou ser o autor' },
      headers,
    )
    expect(res.status).toBe(200)
    expect(await statusOf(id)).toBe('rejected')
    const [ev] = await getDb()
      .select()
      .from(dsarAuditEvent)
      .where(and(eq(dsarAuditEvent.caseId, id), eq(dsarAuditEvent.eventType, 'DSAR_REJECTED')))
    expect(ev.reason).toBe('não comprovou ser o autor')
  })

  it('2º encerramento → 409 sem novo evento; ticket inexistente → 404; id inválido → 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm3@resolve.test', role: 'admin' })
    const id = await openTicket()
    expect((await call({ ticketId: id, resolution: 'fulfilled' }, headers)).status).toBe(200)
    expect(
      (await call({ ticketId: id, resolution: 'rejected', reason: 'x' }, headers)).status,
    ).toBe(409)
    expect(await eventsFor(id)).toHaveLength(1)
    expect(await statusOf(id)).toBe('fulfilled')

    expect(
      (
        await call(
          { ticketId: '00000000-0000-4000-8000-000000000000', resolution: 'fulfilled' },
          headers,
        )
      ).status,
    ).toBe(404)
    expect((await call({ ticketId: 'nope', resolution: 'fulfilled' }, headers)).status).toBe(400)
  })
})
