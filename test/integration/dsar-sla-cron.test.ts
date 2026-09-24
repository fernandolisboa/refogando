import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET } from '@/app/api/cron/dsar-sla/route'
import { scanDsarSla } from '@/server/legal/dsar-sla-scan'
import { getDb } from '@/server/deps'
import { takedownTicket } from '@/db/schema'

/**
 * Cron de alertas de SLA DSAR (#400, GAP-7). Duas frentes:
 *  - `scanDsarSla` com `now` INJETADO (datas simuladas): computa/registra os níveis 10/13/15 sobre
 *    tickets ABERTOS, escala no dia 13, é IDEMPOTENTE e ignora tickets resolvidos.
 *  - GET /api/cron/dsar-sla: fail-closed no `CRON_SECRET` (401 sem secret / header errado; 200 com Bearer).
 *
 * `received_at` é INSERIDO no passado para simular a idade — o kernel é puro, mas a escrita/varredura
 * toca o DB descartável (porta real).
 */

const NOW = new Date('2026-07-01T09:00:00.000Z')
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

async function openTicket(receivedAt: Date, over: Partial<{ status: string; slaLevel: string }> = {}) {
  const [row] = await getDb()
    .insert(takedownTicket)
    .values({
      requestType: 'name_removal',
      displayName: 'Autor Externo',
      message: 'pedido de remoção',
      receivedAt,
      status: over.status ?? 'received',
      slaLevel: over.slaLevel ?? 'none',
    })
    .returning({ id: takedownTicket.id })
  return row.id
}

async function loadTicket(id: string) {
  const [row] = await getDb().select().from(takedownTicket).where(eq(takedownTicket.id, id))
  return row
}

describe('scanDsarSla (datas simuladas via now injetado)', () => {
  it('registra os 3 níveis por idade e deixa o recente em none', async () => {
    const recente = await openTicket(daysBefore(5))
    const amarelo = await openTicket(daysBefore(10))
    const vermelho = await openTicket(daysBefore(13))
    const vencido = await openTicket(daysBefore(15))

    const result = await scanDsarSla(getDb(), NOW)

    expect(result.scanned).toBe(4)
    // 3 transições (o recente não alerta).
    expect(result.transitions).toHaveLength(3)

    expect((await loadTicket(recente)).slaLevel).toBe('none')
    expect((await loadTicket(amarelo)).slaLevel).toBe('yellow')
    expect((await loadTicket(vermelho)).slaLevel).toBe('red')
    expect((await loadTicket(vencido)).slaLevel).toBe('overdue')

    // Cada transição gravada carimba o momento do alerta.
    expect((await loadTicket(vencido)).slaAlertedAt).toBeInstanceOf(Date)
    // Só o recente fica sem carimbo (nunca alertado).
    expect((await loadTicket(recente)).slaAlertedAt).toBeNull()
  })

  it('escalonamento no dia 13: transição para red (escalona ao Encarregado)', async () => {
    const id = await openTicket(daysBefore(13))
    const result = await scanDsarSla(getDb(), NOW)
    const escalonamento = result.transitions.find((t) => t.ticketId === id)
    expect(escalonamento).toEqual({ ticketId: id, from: 'none', to: 'red', ageDays: 13 })
  })

  it('idempotente: 2ª varredura no mesmo now não re-alerta nem re-carimba', async () => {
    const id = await openTicket(daysBefore(13))

    const first = await scanDsarSla(getDb(), NOW)
    expect(first.transitions).toHaveLength(1)
    const alertadoEm = (await loadTicket(id)).slaAlertedAt

    const second = await scanDsarSla(getDb(), NOW)
    expect(second.transitions).toHaveLength(0) // nada avançou
    expect((await loadTicket(id)).slaLevel).toBe('red') // inalterado
    expect((await loadTicket(id)).slaAlertedAt).toEqual(alertadoEm) // sem re-carimbo
  })

  it('avança de yellow para red quando o tempo passa (nova varredura, now mais tarde)', async () => {
    const id = await openTicket(daysBefore(13)) // 10 dias atrás relativo a NOW-3d
    const antes = new Date(NOW.getTime() - 3 * 86_400_000) // aqui tem 10 dias → yellow
    const r1 = await scanDsarSla(getDb(), antes)
    expect(r1.transitions[0]?.to).toBe('yellow')
    expect((await loadTicket(id)).slaLevel).toBe('yellow')

    const r2 = await scanDsarSla(getDb(), NOW) // agora tem 13 dias → red
    expect(r2.transitions).toEqual([{ ticketId: id, from: 'yellow', to: 'red', ageDays: 13 }])
    expect((await loadTicket(id)).slaLevel).toBe('red')
  })

  it('ignora tickets resolvidos (fulfilled/rejected) — SLA parou de correr', async () => {
    const fulfilled = await openTicket(daysBefore(20), { status: 'fulfilled' })
    const rejected = await openTicket(daysBefore(20), { status: 'rejected' })

    const result = await scanDsarSla(getDb(), NOW)

    expect(result.scanned).toBe(0) // nenhum aberto
    expect(result.transitions).toHaveLength(0)
    expect((await loadTicket(fulfilled)).slaLevel).toBe('none') // intocado
    expect((await loadTicket(rejected)).slaLevel).toBe('none')
  })
})

describe('GET /api/cron/dsar-sla (auth fail-closed no CRON_SECRET)', () => {
  const original = process.env.CRON_SECRET

  beforeEach(() => {
    delete process.env.CRON_SECRET
  })
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })

  const call = (headers: Record<string, string> = {}) =>
    GET(new Request('http://localhost/api/cron/dsar-sla', { headers }))

  it('sem CRON_SECRET no ambiente → 401 (deploy-gate humano, fecha o job)', async () => {
    // beforeEach já removeu o secret. Mesmo com Bearer no header, sem secret setado é 401.
    const res = await call({ authorization: 'Bearer qualquer' })
    expect(res.status).toBe(401)
  })

  it('com CRON_SECRET setado mas header ausente/errado → 401', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    expect((await call()).status).toBe(401) // sem header
    expect((await call({ authorization: 'Bearer errado' })).status).toBe(401) // header errado
    expect((await call({ authorization: 'segredo-de-teste' })).status).toBe(401) // sem prefixo Bearer
  })

  it('com Bearer correto → 200 e varre os tickets abertos', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    // A rota usa `new Date()` REAL — ancoramos o received_at no relógio real (não na constante NOW) para
    // que a idade seja determinística (20 dias atrás ⇒ vencido) independentemente do dia do CI.
    const id = await openTicket(new Date(Date.now() - 20 * 86_400_000))

    const res = await call({ authorization: 'Bearer segredo-de-teste' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scanned: number; transitions: number }
    expect(body.scanned).toBeGreaterThanOrEqual(1)
    expect(body.transitions).toBeGreaterThanOrEqual(1)
    expect((await loadTicket(id)).slaLevel).toBe('overdue')
  })
})
