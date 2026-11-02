import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isNull } from 'drizzle-orm'
import { POST } from '@/app/api/legal/takedown/route'
import { GET as dsarSlaGET } from '@/app/api/cron/dsar-sla/route'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { rateLimitWindow, takedownTicket } from '@/db/schema'
import { RATE_LIMITS } from '@/domain/rate-limit-rules'
import { DPO_DIGEST_MAX_LISTED, notifyDpoDigest, notifyDpoRedTickets } from '@/server/legal/dpo-alert'

/**
 * Enxurrada no formulário público de Seus direitos (#648, ADR-0057) pela porta alta (POST /api/legal/takedown):
 * limitador persistido por IP (IPv6 pela /64) e no total, teto de e-mails por hora ao Encarregado, e o resumo diário
 * do cron `dsar-sla`, que lista o que o teto segurou. Os tickets acima do teto de e-mail são gravados do mesmo jeito.
 *
 * O throttle em memória da rota (1/s por IP CRU) fica no módulo entre os testes: cada teste usa IPs próprios.
 */

const DPO = 'dpo@refogando.example'
const valid = { requestType: 'name_removal', displayName: 'Autor Externo', message: 'Removam meu nome, por favor.' }

function post(ip: string, body: unknown = valid): Promise<Response> {
  return POST(
    new Request('http://localhost/api/legal/takedown', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify(body),
    }),
  )
}

const tickets = () => getDb().select().from(takedownTicket)

let mailer: FakeMailer
const originalDpo = process.env.DSAR_DPO_EMAIL

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T12:10:00.000Z')) // meio das janelas de 30 min e de 1 h
  process.env.DSAR_DPO_EMAIL = DPO
  mailer = new FakeMailer()
  setMailer(mailer)
})
afterEach(() => {
  vi.useRealTimers()
  if (originalDpo === undefined) delete process.env.DSAR_DPO_EMAIL
  else process.env.DSAR_DPO_EMAIL = originalDpo
})

describe('limitador persistido do formulário', () => {
  it('mesmo IPv6 /64 girando o endereço: passa o limite por IP e depois 429 com retryAfterMs', async () => {
    const limit = RATE_LIMITS.takedown_ip.limit
    const statuses: number[] = []
    for (let i = 0; i < limit + 2; i++) statuses.push((await post(`2001:db8:aa:1::${i + 1}`)).status)
    expect(statuses).toEqual([...Array(limit).fill(201), 429, 429])

    const res = await post('2001:db8:aa:1::ff')
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('1200') // 20 min até a virada da janela de 30 min
    expect(await res.json()).toEqual({ error: 'rate_limited', retryAfterMs: 20 * 60_000 })
    expect(await tickets()).toHaveLength(limit) // o barrado não grava ticket
  })

  it('laço de POSTs de IPs variados: o teto total barra, e nenhuma chave guarda o IP em claro', async () => {
    const limit = RATE_LIMITS.takedown_global.limit
    const statuses: number[] = []
    for (let i = 0; i < limit + 5; i++) statuses.push((await post(`10.20.${Math.floor(i / 250)}.${i % 250}`)).status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(limit)
    expect(statuses.slice(limit)).toEqual(Array(5).fill(429))
    expect(await tickets()).toHaveLength(limit)
    expect(JSON.stringify(await getDb().select().from(rateLimitWindow))).not.toContain('10.20.0.')
  })

  it('pedido inválido não gasta o limite (400 antes do limitador)', async () => {
    for (let i = 0; i < 10; i++) expect((await post(`2001:db8:bb:1::${i + 1}`, { message: '' })).status).toBe(400)
    expect(await getDb().select().from(rateLimitWindow)).toHaveLength(0)
  })
})

describe('teto de e-mails ao Encarregado', () => {
  it('no máximo `dpo_email` por hora; os tickets acima do teto são gravados e saem no resumo diário', async () => {
    const cap = RATE_LIMITS.dpo_email.limit
    const total = cap + 7
    for (let i = 0; i < total; i++) expect((await post(`172.16.5.${i + 1}`)).status).toBe(201)

    expect(await tickets()).toHaveLength(total) // todos gravados
    expect(mailer.sent).toHaveLength(cap) // só `cap` e-mails individuais
    const pending = await getDb().select().from(takedownTicket).where(isNull(takedownTicket.dpoArrivalNotifiedAt))
    expect(pending).toHaveLength(7)

    // O resumo diário (fora do teto) avisa os 7, com os protocolos, e os carimba.
    const now = new Date()
    const digest = await notifyDpoDigest(getDb(), mailer, now)
    expect(digest).toEqual({ sent: true, arrivals: 7, redPending: 0 })
    expect(mailer.sent).toHaveLength(cap + 1)
    const body = mailer.sent.at(-1)!.text
    for (const t of pending) expect(body).toContain(t.id)
    expect(body).not.toContain('Autor Externo') // sem dado do titular
    expect(body).not.toContain('Removam meu nome')
    expect(await getDb().select().from(takedownTicket).where(isNull(takedownTicket.dpoArrivalNotifiedAt))).toHaveLength(0)

    // Nada pendente ⇒ sem resumo.
    expect(await notifyDpoDigest(getDb(), mailer, now)).toEqual({ sent: false, arrivals: 0, redPending: 0 })
    expect(mailer.sent).toHaveLength(cap + 1)
  })

  it('envio recusado pelo provedor deixa o ticket sem carimbo, e ele entra no resumo', async () => {
    setMailer({
      sendDpoAlert: async () => ({ sent: false }),
      sendAccountEmail: async () => ({ sent: false }),
      canSendAccountEmail: () => true,
    })
    expect((await post('172.16.6.1')).status).toBe(201)
    const [t] = await tickets()
    expect(t.dpoArrivalNotifiedAt).toBeNull()
    const digest = await notifyDpoDigest(getDb(), mailer, new Date())
    expect(digest.arrivals).toBe(1)
  })

  it('alertas de SLA por ticket também respeitam o teto; o resumo lista os vermelhos que sobraram, sem carimbá-los', async () => {
    const cap = RATE_LIMITS.dpo_email.limit
    const now = new Date()
    const received = new Date(now.getTime() - 13 * 86_400_000)
    const extra = DPO_DIGEST_MAX_LISTED + 5
    await getDb()
      .insert(takedownTicket)
      .values(
        Array.from({ length: cap + extra }, () => ({
          requestType: 'other',
          displayName: 'X',
          message: 'm',
          receivedAt: received,
          slaLevel: 'red',
          dpoArrivalNotifiedAt: received,
        })),
      )

    const alert = await notifyDpoRedTickets(getDb(), mailer, now)
    expect(alert.notified).toBe(cap)
    expect(mailer.sent).toHaveLength(cap)

    const digest = await notifyDpoDigest(getDb(), mailer, now)
    expect(digest).toEqual({ sent: true, arrivals: 0, redPending: extra })
    const body = mailer.sent.at(-1)!.text
    expect(body).toContain(`Em escalonamento ou vencidos sem alerta individual: ${extra}`)
    expect(body).toContain('… e mais 5 no painel.')
    // Os vermelhos seguem sem `dpo_notified_at`: o alerta individual sai quando o teto deixar (amanhã).
    expect(await getDb().select().from(takedownTicket).where(isNull(takedownTicket.dpoNotifiedAt))).toHaveLength(extra)
  })
})

describe('GET /api/cron/dsar-sla', () => {
  const originalSecret = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = 'segredo-de-teste'
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('manda o resumo dos tickets sem aviso de chegada e devolve só contagens', async () => {
    await getDb().insert(takedownTicket).values({ requestType: 'other', displayName: 'Y', message: 'm' })
    const res = await dsarSlaGET(
      new Request('http://localhost/api/cron/dsar-sla', { headers: { authorization: 'Bearer segredo-de-teste' } }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ dpoDigest: { sent: true, arrivals: 1, redPending: 0 } })
    expect(mailer.sent).toHaveLength(1)
  })
})
