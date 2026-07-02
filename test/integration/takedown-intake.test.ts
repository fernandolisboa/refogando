import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST } from '@/app/api/legal/takedown/route'
import { getDb } from '@/server/deps'
import { takedownTicket, dsarAuditEvent } from '@/db/schema'

/**
 * Intake PÚBLICO de takedown (#399, GAP-2) pela porta MAIS ALTA (POST /api/legal/takedown). Cookie-free
 * (titular B não tem conta), abre um ticket com `received_at` (início do SLA) e grava `DSAR_RECEIVED`
 * na MESMA transação (canal 'web_form', requestType, caseId = ticketId, actorId null). Sanitiza a
 * entrada (anti-500) e valida os campos mínimos (400 sem vazar).
 */

function post(body: unknown, url = 'http://localhost/api/legal/takedown'): Promise<Response> {
  return POST(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

async function loadTicket(id: string) {
  const [row] = await getDb().select().from(takedownTicket).where(eq(takedownTicket.id, id))
  return row
}

async function loadEventsByCase(caseId: string) {
  return getDb()
    .select({
      eventType: dsarAuditEvent.eventType,
      channel: dsarAuditEvent.channel,
      requestType: dsarAuditEvent.requestType,
      caseId: dsarAuditEvent.caseId,
      actorId: dsarAuditEvent.actorId,
      payloadHash: dsarAuditEvent.payloadHash,
      details: dsarAuditEvent.details,
    })
    .from(dsarAuditEvent)
    .where(eq(dsarAuditEvent.caseId, caseId))
}

describe('POST /api/legal/takedown (#399 intake público)', () => {
  it('pedido válido → 201; abre ticket com received_at e status received', async () => {
    const res = await post({
      requestType: 'name_removal',
      sourceUrl: 'https://exemplo.com/receita',
      displayName: 'Cozinha da Vovó',
      message: 'Por favor removam meu nome do crédito.',
      contactEmail: 'autor@exemplo.com',
    })
    expect(res.status).toBe(201)
    const { ticketId } = (await res.json()) as { ticketId: string }
    expect(ticketId).toMatch(/^[0-9a-f-]{36}$/)

    const t = await loadTicket(ticketId)
    expect(t.requestType).toBe('name_removal')
    expect(t.sourceUrl).toBe('https://exemplo.com/receita')
    expect(t.displayName).toBe('Cozinha da Vovó')
    expect(t.message).toBe('Por favor removam meu nome do crédito.')
    expect(t.contactEmail).toBe('autor@exemplo.com')
    expect(t.status).toBe('received') // default do schema
    expect(t.receivedAt).toBeInstanceOf(Date) // início do SLA
  })

  it('grava exatamente 1 DSAR_RECEIVED (web_form, actor null, caseId = ticket) — sem dado em claro na auditoria', async () => {
    const MENSAGEM = 'Sou o autor e quero remover meu nome secreto.'
    const NOME = 'Segredo do Chef'
    const res = await post({
      requestType: 'full_removal',
      displayName: NOME,
      message: MENSAGEM,
    })
    expect(res.status).toBe(201)
    const { ticketId } = (await res.json()) as { ticketId: string }

    const events = await loadEventsByCase(ticketId)
    expect(events).toHaveLength(1)
    const [ev] = events
    expect(ev.eventType).toBe('DSAR_RECEIVED')
    expect(ev.channel).toBe('web_form')
    expect(ev.requestType).toBe('full_removal')
    expect(ev.caseId).toBe(ticketId)
    expect(ev.actorId).toBeNull() // titular B não tem conta
    expect(ev.payloadHash).toBeNull() // só o FULFILLED carrega hash

    // MINIMIZAÇÃO: o dado do titular (nome/pedido) vive no ticket, NUNCA na trilha de auditoria.
    const serialized = JSON.stringify(ev)
    expect(serialized).not.toContain(NOME)
    expect(serialized).not.toContain(MENSAGEM)
  })

  it('mensagem ausente → 400 pedido_obrigatorio; nenhum ticket criado', async () => {
    const before = (await getDb().select().from(takedownTicket)).length
    const res = await post({ sourceUrl: 'https://exemplo.com' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('pedido_obrigatorio')
    expect((await getDb().select().from(takedownTicket)).length).toBe(before)
  })

  it('sem identificador (só mensagem) → 400 identificacao_obrigatoria', async () => {
    const res = await post({ message: 'quero remover algo' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('identificacao_obrigatoria')
  })

  it('corpo malformado (não-JSON) → 400 (cai em {} → pedido_obrigatorio), nunca 500', async () => {
    const res = await POST(
      new Request('http://localhost/api/legal/takedown', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'isto não é json',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('anti-500: NUL nos campos → 201 (saneado antes do INSERT), não 500', async () => {
    const NUL = String.fromCharCode(0)
    const res = await post({
      requestType: 'name_removal',
      displayName: `Nome${NUL}com nul`,
      message: `pedido${NUL}com nul`,
    })
    expect(res.status).toBe(201)
    const { ticketId } = (await res.json()) as { ticketId: string }
    const t = await loadTicket(ticketId)
    expect(t.message.includes(NUL)).toBe(false) // NUL neutralizado (viraria 500 no postgres-js)
  })
})
