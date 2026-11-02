import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isNull } from 'drizzle-orm'
import { POST } from '@/app/api/legal/takedown/route'
import { GET as dsarSlaGET } from '@/app/api/cron/dsar-sla/route'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { rateLimitWindow, takedownTicket } from '@/db/schema'
import { DPO_ARRIVAL_DAY_SHARE, GLOBAL_LIMIT_KEY, RATE_LIMITS } from '@/domain/rate-limit-rules'
import { consumeRateLimit } from '@/server/rate-limit/window'
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
  it('no máximo `dpo_email_arrival` por hora; os tickets acima do teto são gravados e saem no resumo diário', async () => {
    const cap = RATE_LIMITS.dpo_email_arrival.limit
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

  it('alertas de SLA por ticket têm teto próprio; o resumo lista TODOS os vermelhos que sobraram, sem carimbá-los', async () => {
    const cap = RATE_LIMITS.dpo_email_sla.limit
    const now = new Date()
    const received = new Date(now.getTime() - 13 * 86_400_000)
    const extra = DPO_DIGEST_MAX_LISTED + 5
    await insertRed(cap + extra, received)

    const alert = await notifyDpoRedTickets(getDb(), mailer, now)
    expect(alert.notified).toBe(cap)
    expect(mailer.sent).toHaveLength(cap)

    const digest = await notifyDpoDigest(getDb(), mailer, now)
    expect(digest).toEqual({ sent: true, arrivals: 0, redPending: extra })
    const body = mailer.sent.at(-1)!.text
    expect(body).toContain(`Em escalonamento ou vencidos sem alerta individual: ${extra}`)
    expect(body).not.toContain('no painel.') // vermelho nunca fica escondido atrás do corte de linhas
    const pendingRed = await getDb().select().from(takedownTicket).where(isNull(takedownTicket.dpoNotifiedAt))
    expect(pendingRed).toHaveLength(extra) // seguem sem `dpo_notified_at`: o alerta individual sai amanhã
    for (const t of pendingRed) expect(body).toContain(t.id)
  })

  it('uma enxurrada de chegadas não cala o alerta de prazo: o balde por hora da chegada é outro', async () => {
    const arrivalCap = RATE_LIMITS.dpo_email_arrival.limit
    for (let i = 0; i < arrivalCap + 3; i++) expect((await post(`172.16.7.${i + 1}`)).status).toBe(201)
    expect(mailer.sent).toHaveLength(arrivalCap)

    await insertRed(3, new Date(Date.now() - 14 * 86_400_000))
    const alert = await notifyDpoRedTickets(getDb(), mailer, new Date())
    expect(alert.notified).toBe(3)
    expect(mailer.sent.slice(arrivalCap).every((m) => m.subject.includes('Alerta de SLA'))).toBe(true)
  })

  it('teto diário: a chegada usa só a parte dela; o alerta de prazo usa o resto e para no teto do dia', async () => {
    const now = new Date()
    const day = { bucket: 'dpo_email_day' as const, key: GLOBAL_LIMIT_KEY }
    // A chegada já gastou a parte dela hoje (em horas anteriores).
    for (let i = 0; i < DPO_ARRIVAL_DAY_SHARE; i++) await consumeRateLimit(getDb(), { ...day, limit: DPO_ARRIVAL_DAY_SHARE }, now)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect((await post('172.16.8.1')).status).toBe(201)
    expect(mailer.sent).toHaveLength(0) // sem e-mail de chegada: só no resumo
    expect(info.mock.calls.flat().join('\n')).toContain('motivo=teto_diario')
    info.mockRestore()
    // A unidade por hora da chegada foi devolvida (o e-mail não saiu).
    const arrivalRow = (await getDb().select().from(rateLimitWindow)).find((w) => w.bucket === 'dpo_email_arrival')
    expect(arrivalRow?.count).toBe(0)

    // O alerta de prazo ainda tem `limite - parte da chegada` no dia.
    const reserved = RATE_LIMITS.dpo_email_day.limit - DPO_ARRIVAL_DAY_SHARE
    await insertRed(reserved + 4, new Date(now.getTime() - 13 * 86_400_000))
    const first = await notifyDpoRedTickets(getDb(), mailer, now)
    expect(first.notified).toBe(Math.min(reserved, RATE_LIMITS.dpo_email_sla.limit))
    // Uma hora depois (balde por hora renovado), o teto DIÁRIO segura o resto.
    const next = await notifyDpoRedTickets(getDb(), mailer, new Date(now.getTime() + 60 * 60_000))
    expect(first.notified + next.notified).toBe(reserved)
    const dayRow = (await getDb().select().from(rateLimitWindow)).find((w) => w.bucket === 'dpo_email_day')
    expect(dayRow?.count).toBe(RATE_LIMITS.dpo_email_day.limit)
  })

  it('alerta de prazo: os mais antigos primeiro (o prazo mais perto recebe o e-mail individual)', async () => {
    const now = new Date()
    const cap = RATE_LIMITS.dpo_email_sla.limit
    // Inseridos do mais novo para o mais antigo, para a ordem física não coincidir com a do prazo.
    const ages = Array.from({ length: cap + 4 }, (_, i) => 13 * 86_400_000 + i * 3_600_000)
    for (const age of ages) await insertRed(1, new Date(now.getTime() - age))
    await notifyDpoRedTickets(getDb(), mailer, now)
    const rows = await tickets()
    const notified = rows.filter((t) => t.dpoNotifiedAt !== null).map((t) => t.receivedAt.getTime())
    const oldest = [...rows].map((t) => t.receivedAt.getTime()).sort((a, b) => a - b).slice(0, cap)
    expect(notified.sort((a, b) => a - b)).toEqual(oldest)
  })

  it('resumo: vermelhos antes das chegadas, ticket nas duas listas aparece uma vez, e o assunto conta tickets distintos', async () => {
    const now = new Date()
    const old = new Date(now.getTime() - 13 * 86_400_000)
    // 1 vermelho também sem aviso de chegada (nas duas listas) e 2 só de chegada.
    const [both] = await getDb()
      .insert(takedownTicket)
      .values({ requestType: 'other', displayName: 'X', message: 'm', receivedAt: old, slaLevel: 'red' })
      .returning({ id: takedownTicket.id })
    await getDb()
      .insert(takedownTicket)
      .values([
        { requestType: 'other', displayName: 'X', message: 'm' },
        { requestType: 'other', displayName: 'X', message: 'm' },
      ])
    // Mais chegadas do que o corte, para provar que o corte morde as chegadas e não os vermelhos.
    await getDb()
      .insert(takedownTicket)
      .values(Array.from({ length: DPO_DIGEST_MAX_LISTED }, () => ({ requestType: 'other', displayName: 'X', message: 'm' })))

    const digest = await notifyDpoDigest(getDb(), mailer, now)
    const arrivalsOnly = DPO_DIGEST_MAX_LISTED + 2
    expect(digest).toEqual({ sent: true, arrivals: arrivalsOnly + 1, redPending: 1 })
    const mail = mailer.sent.at(-1)!
    expect(mail.subject).toContain(`Resumo diário: ${arrivalsOnly + 1} pedido(s)`)
    const body = mail.text
    expect(body.split(both.id)).toHaveLength(2) // uma ocorrência só
    expect(body.indexOf('Em escalonamento ou vencidos')).toBeLessThan(body.indexOf('Recebidos sem aviso de chegada'))
    expect(body).toContain(`Recebidos sem aviso de chegada: ${arrivalsOnly}`)
    expect(body).toContain('… e mais 2 no painel.')
    // Todos os de chegada (inclusive o listado como vermelho) ficam carimbados; o vermelho segue sem alerta individual.
    expect(await getDb().select().from(takedownTicket).where(isNull(takedownTicket.dpoArrivalNotifiedAt))).toHaveLength(0)
    expect(await getDb().select().from(takedownTicket).where(isNull(takedownTicket.dpoNotifiedAt))).toHaveLength(
      arrivalsOnly + 1,
    )
  })
})

async function insertRed(n: number, receivedAt: Date) {
  await getDb()
    .insert(takedownTicket)
    .values(
      Array.from({ length: n }, () => ({
        requestType: 'other',
        displayName: 'X',
        message: 'm',
        receivedAt,
        slaLevel: 'red',
        dpoArrivalNotifiedAt: receivedAt,
      })),
    )
}

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
