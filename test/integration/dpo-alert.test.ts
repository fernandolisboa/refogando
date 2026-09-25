import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { notifyDpoRedTickets } from '@/server/legal/dpo-alert'
import { getDb, setMailer } from '@/server/deps'
import { FakeMailer } from '@/server/mail/mailer'
import { takedownTicket } from '@/db/schema'

/**
 * Alerta POR E-MAIL ao Encarregado (#413). Injeta `FakeMailer` via `setMailer` e espelha o seeding de
 * `dsar-sla-cron.test.ts` (received_at no passado). Prova: ticket 'red'/'overdue' não-notificado → envia +
 * carimba `dpo_notified_at`; 2ª rodada → NÃO reenvia (idempotência); ticket resolvido → não envia; sem
 * `DSAR_DPO_EMAIL` → no-op. Toca o DB descartável (porta real).
 */

const NOW = new Date('2026-07-01T09:00:00.000Z')
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const DPO = 'dpo@refogando.example'

async function openTicket(
  receivedAt: Date,
  over: Partial<{ status: string; slaLevel: string }> = {},
) {
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

describe('notifyDpoRedTickets (#413)', () => {
  const original = process.env.DSAR_DPO_EMAIL
  let mailer: FakeMailer

  beforeEach(() => {
    process.env.DSAR_DPO_EMAIL = DPO
    mailer = new FakeMailer()
    setMailer(mailer)
  })
  afterEach(() => {
    if (original === undefined) delete process.env.DSAR_DPO_EMAIL
    else process.env.DSAR_DPO_EMAIL = original
  })

  it('ticket red não-notificado → envia e carimba dpo_notified_at', async () => {
    const id = await openTicket(daysBefore(13), { slaLevel: 'red' })

    const result = await notifyDpoRedTickets(getDb(), mailer, NOW)

    expect(result.notified).toBe(1)
    expect(mailer.sent).toHaveLength(1)
    expect(mailer.sent[0].to).toBe(DPO)
    expect(mailer.sent[0].text).toContain(id) // protocolo no corpo
    expect((await loadTicket(id)).dpoNotifiedAt).toBeInstanceOf(Date)
  })

  it('ticket overdue também dispara (nível crítico)', async () => {
    await openTicket(daysBefore(15), { slaLevel: 'overdue' })
    const result = await notifyDpoRedTickets(getDb(), mailer, NOW)
    expect(result.notified).toBe(1)
  })

  it('2ª rodada não reenvia (idempotência por dpo_notified_at)', async () => {
    await openTicket(daysBefore(13), { slaLevel: 'red' })

    const first = await notifyDpoRedTickets(getDb(), mailer, NOW)
    expect(first.notified).toBe(1)

    const second = await notifyDpoRedTickets(getDb(), mailer, NOW)
    expect(second.notified).toBe(0)
    expect(mailer.sent).toHaveLength(1) // nada enviado na 2ª
  })

  it('ticket resolvido (fulfilled) com red → não envia', async () => {
    const id = await openTicket(daysBefore(20), { slaLevel: 'red', status: 'fulfilled' })
    const result = await notifyDpoRedTickets(getDb(), mailer, NOW)
    expect(result.notified).toBe(0)
    expect(mailer.sent).toHaveLength(0)
    expect((await loadTicket(id)).dpoNotifiedAt).toBeNull()
  })

  it('nível yellow/none não dispara (só crítico)', async () => {
    await openTicket(daysBefore(10), { slaLevel: 'yellow' })
    await openTicket(daysBefore(5), { slaLevel: 'none' })
    const result = await notifyDpoRedTickets(getDb(), mailer, NOW)
    expect(result.notified).toBe(0)
    expect(mailer.sent).toHaveLength(0)
  })

  it('sem DSAR_DPO_EMAIL → no-op (não envia nem carimba)', async () => {
    delete process.env.DSAR_DPO_EMAIL
    const id = await openTicket(daysBefore(13), { slaLevel: 'red' })

    const result = await notifyDpoRedTickets(getDb(), mailer, NOW)

    expect(result.notified).toBe(0)
    expect(mailer.sent).toHaveLength(0)
    expect((await loadTicket(id)).dpoNotifiedAt).toBeNull()
  })

  it('envio que FALHA (sent:false) não carimba → reenvia na próxima', async () => {
    const failing = {
      sent: [] as Array<{ to: string }>,
      async sendDpoAlert(i: { to: string }) {
        this.sent.push(i)
        return { sent: false }
      },
      async sendAccountEmail() {
        return { sent: false }
      },
      canSendAccountEmail() {
        return false
      },
    }
    setMailer(failing)
    const id = await openTicket(daysBefore(13), { slaLevel: 'red' })

    const result = await notifyDpoRedTickets(getDb(), failing, NOW)

    expect(result.notified).toBe(0)
    expect(failing.sent).toHaveLength(1) // tentou
    expect((await loadTicket(id)).dpoNotifiedAt).toBeNull() // mas não carimbou
  })
})
