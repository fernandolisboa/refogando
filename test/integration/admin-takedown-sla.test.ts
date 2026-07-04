import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/admin/takedown-sla/route'
import { getDb } from '@/server/deps'
import { takedownTicket } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Painel de SLA de takedown/DSAR (#412, GAP-7) pela porta real (GET /api/admin/takedown-sla).
 * ADMIN-ONLY (anon → 401; Usuário → 403; Admin → 200). Prova o CONTRATO central: os tickets
 * RESOLVIDOS (fulfilled/rejected) — que RETÊM um `sla_level` alto — NÃO aparecem; só os abertos
 * (received/verified) voltam, ordenados por `received_at` desc.
 *
 * O `received_at` é back-dated para simular idade; o filtro por status é o que este teste crava.
 */

const NOW = Date.now()
const daysBefore = (n: number) => new Date(NOW - n * 86_400_000)

async function openTicket(
  receivedAt: Date,
  over: Partial<{ status: string; slaLevel: string; displayName: string; requestType: string }> = {},
): Promise<string> {
  const [row] = await getDb()
    .insert(takedownTicket)
    .values({
      requestType: over.requestType ?? 'name_removal',
      displayName: over.displayName ?? 'Autor Externo',
      message: 'pedido de remoção',
      receivedAt,
      status: over.status ?? 'received',
      slaLevel: over.slaLevel ?? 'none',
    })
    .returning({ id: takedownTicket.id })
  return row.id
}

function call(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/admin/takedown-sla', { headers }))
}

async function idsInBody(res: Response): Promise<string[]> {
  const body = (await res.json()) as { tickets: { id: string }[] }
  return body.tickets.map((t) => t.id)
}

describe('GET /api/admin/takedown-sla — gate de papel', () => {
  it('anônimo (sem sessão) → 401', async () => {
    expect((await call()).status).toBe(401)
  })

  it('usuário comum → 403 (gate de verdade, não link escondido)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'u@sla.test', role: 'usuario' })
    expect((await call(headers)).status).toBe(403)
  })

  it('admin → 200', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm@sla.test', role: 'admin' })
    expect((await call(headers)).status).toBe(200)
  })
})

describe('GET /api/admin/takedown-sla — filtra os RESOLVIDOS (retêm sla_level alto)', () => {
  it('resolvidos (fulfilled/rejected) NÃO voltam; um aberto velho volta', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm-filter@sla.test', role: 'admin' })

    // Resolvidos, MAS ainda carregando um nível de SLA alto — NÃO podem aparecer.
    const fulfilled = await openTicket(daysBefore(20), { status: 'fulfilled', slaLevel: 'red' })
    const rejected = await openTicket(daysBefore(20), { status: 'rejected', slaLevel: 'overdue' })
    // Aberto e velho — DEVE aparecer.
    const abertoVelho = await openTicket(daysBefore(14), { status: 'received', slaLevel: 'red' })
    // Aberto 'verified' (também segue correndo) — DEVE aparecer.
    const verificado = await openTicket(daysBefore(11), { status: 'verified', slaLevel: 'yellow' })

    const res = await call(headers)
    expect(res.status).toBe(200)
    const ids = await idsInBody(res)

    expect(ids).toContain(abertoVelho)
    expect(ids).toContain(verificado)
    expect(ids).not.toContain(fulfilled)
    expect(ids).not.toContain(rejected)
  })

  it('devolve os metadados esperados e ordena por received_at desc (mais recente primeiro)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm-order@sla.test', role: 'admin' })

    const antigo = await openTicket(daysBefore(13), { displayName: 'Fonte Antiga' })
    const recente = await openTicket(daysBefore(2), { displayName: 'Fonte Recente' })

    const res = await call(headers)
    const body = (await res.json()) as {
      tickets: { id: string; requestType: string; displayName: string | null; slaLevel: string }[]
    }
    const mine = body.tickets.filter((t) => t.id === antigo || t.id === recente)
    // Ordem desc por received_at: o recente vem antes do antigo.
    expect(mine.map((t) => t.id)).toEqual([recente, antigo])
    const row = body.tickets.find((t) => t.id === recente)!
    expect(row.requestType).toBe('name_removal')
    expect(row.displayName).toBe('Fonte Recente')
    expect(typeof row.slaLevel).toBe('string')
  })
})
