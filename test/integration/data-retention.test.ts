import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { GET } from '@/app/api/cron/retention/route'
import { getDb } from '@/server/deps'
import {
  briefing,
  creationSession,
  dsarAuditEvent,
  extractionEvent,
  generation,
  imageGeneration,
  mealPlanSuggestionEvent,
  session,
  takedownTicket,
  users,
  verification,
} from '@/db/schema'
import { SCHEMA_VERSION_RECEITA } from '@/domain/recipe'
import { retentionCutoffs } from '@/domain/data-retention'
import { RETENTION_STEPS, deleteInBatches, type RetentionStepOpts } from '@/server/legal/data-retention'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import { purgeStalePendingSignups, wasPendingSignupPurged } from '@/server/auth/pending-signup-purge'
import { seedUser } from '../helpers/users'
import { seedBriefing } from '../helpers/generation'

/**
 * Cron de retenção (#473, ADR-0049) contra o Postgres real, com `now` INJETADO: para cada passo, uma linha
 * logo DENTRO do prazo (1 s mais nova que o corte) fica e uma logo FORA (1 s mais velha) sai. Mais os casos
 * de borda do takedown, a lápide do cadastro expurgado, os cascos das contas eliminadas, lotes, orçamento,
 * idempotência e a rota (401, linha exata, 500 com warn).
 */

const NOW = new Date('2026-10-22T11:30:00.000Z')
const C = retentionCutoffs(NOW)
const DAY = 86_400_000
const inside = (cut: Date) => new Date(cut.getTime() + 1000)
const outside = (cut: Date) => new Date(cut.getTime() - 1000)
const monthsAgo = (n: number) => new Date(NOW.getTime() - n * 30.5 * DAY)

function step(key: string) {
  const s = RETENTION_STEPS.find((x) => x.key === key)
  if (!s) throw new Error(`passo ${key} não existe`)
  return s
}
const run = (key: string, opts?: RetentionStepOpts) => step(key).run(getDb(), NOW, opts)

async function ids<T extends { id: string }>(rows: Promise<T[]>): Promise<string[]> {
  return (await rows).map((r) => r.id).sort()
}

describe('registros de uso de IA (24 meses; extração, 30 dias)', () => {
  it('imageGenerations / mealPlanSuggestions: só o que é mais velho que 24 meses sai', async () => {
    const u = await seedUser({ email: 'uso@ret.test' })
    const [keepImg, dropImg] = await getDb()
      .insert(imageGeneration)
      .values([
        { userId: u, createdAt: inside(C.usageLedger) },
        { userId: u, createdAt: outside(C.usageLedger) },
      ])
      .returning({ id: imageGeneration.id })
    const [keepMenu] = await getDb()
      .insert(mealPlanSuggestionEvent)
      .values([
        { userId: u, createdAt: inside(C.usageLedger) },
        { userId: u, createdAt: outside(C.usageLedger) },
      ])
      .returning({ id: mealPlanSuggestionEvent.id })

    expect(await run('imageGenerations')).toBe(1)
    expect(await run('mealPlanSuggestions')).toBe(1)

    expect(await ids(getDb().select({ id: imageGeneration.id }).from(imageGeneration))).toEqual([keepImg.id])
    expect(dropImg.id).not.toBe(keepImg.id)
    expect(await ids(getDb().select({ id: mealPlanSuggestionEvent.id }).from(mealPlanSuggestionEvent))).toEqual([
      keepMenu.id,
    ])
  })

  it('extractionEvents: 30 dias', async () => {
    const u = await seedUser({ email: 'extracao@ret.test' })
    const [keep] = await getDb()
      .insert(extractionEvent)
      .values([
        { userId: u, createdAt: inside(C.extractionEvent) },
        { userId: u, createdAt: outside(C.extractionEvent) },
      ])
      .returning({ id: extractionEvent.id })

    expect(await run('extractionEvents')).toBe(1)
    expect(await ids(getDb().select({ id: extractionEvent.id }).from(extractionEvent))).toEqual([keep.id])
  })
})

describe('sessões e verificações vencidas', () => {
  it('sessions: a vencida sai (com IP e navegador), a válida fica', async () => {
    const u = await seedUser({ email: 'sessao@ret.test' })
    const [keep] = await getDb()
      .insert(session)
      .values([
        { userId: u, token: 'viva', expiresAt: new Date(NOW.getTime() + 1000), ipAddress: '203.0.113.7' },
        { userId: u, token: 'vencida', expiresAt: new Date(NOW.getTime() - 1000), ipAddress: '203.0.113.8' },
      ])
      .returning({ id: session.id })

    expect(await run('sessions')).toBe(1)
    expect(await ids(getDb().select({ id: session.id }).from(session))).toEqual([keep.id])
  })

  it('verifications: todo tipo vencido sai; o vivo fica', async () => {
    const u = await seedUser({ email: 'verif@ret.test' })
    const past = new Date(NOW.getTime() - 1000)
    const [keep] = await getDb()
      .insert(verification)
      .values([
        { identifier: 'reset-password:viva', value: u, expiresAt: new Date(NOW.getTime() + 1000) },
        { identifier: 'reset-password:vencida', value: u, expiresAt: past },
        { identifier: `password-email-sent:${u}`, value: u, expiresAt: past },
        { identifier: 'pending-signup-purged:abc', value: 'purged', expiresAt: past },
      ])
      .returning({ id: verification.id })

    expect(await run('verifications')).toBe(3)
    expect(await ids(getDb().select({ id: verification.id }).from(verification))).toEqual([keep.id])
  })

  it('a lápide do cadastro expurgado vale os 90 dias dela: fica, e `wasPendingSignupPurged` segue verdadeiro', async () => {
    const email = 'lapide@ret.test'
    const pending = await seedUser({ email, emailVerified: false })
    const realNow = new Date()
    await getDb()
      .update(users)
      .set({ pendingSignupAt: new Date(realNow.getTime() - 72 * 3_600_000) })
      .where(eq(users.id, pending))
    expect(await purgeStalePendingSignups(getDb(), realNow)).toEqual({ pendingSignupsPurged: 1 })

    expect(await step('verifications').run(getDb(), realNow)).toBe(0)
    expect(await wasPendingSignupPurged(getDb(), email, realNow)).toBe(true)

    // Passados os 90 dias, a lápide vence e a retenção a apaga.
    const later = new Date(realNow.getTime() + 91 * DAY)
    expect(await step('verifications').run(getDb(), later)).toBe(1)
    expect(await wasPendingSignupPurged(getDb(), email, later)).toBe(false)
  })
})

describe('tickets de takedown (12 meses após o encerramento)', () => {
  async function ticket(status: string, receivedAt: Date): Promise<string> {
    const [t] = await getDb()
      .insert(takedownTicket)
      .values({ requestType: 'name_removal', message: 'tirar meu nome', status, receivedAt })
      .returning({ id: takedownTicket.id })
    return t.id
  }
  async function event(caseId: string, eventType: 'DSAR_FULFILLED' | 'DSAR_REJECTED' | 'DSAR_RECEIVED', at: Date) {
    const id =
      eventType === 'DSAR_FULFILLED'
        ? await recordDsarEvent(getDb(), {
            eventType,
            caseId,
            fulfillment: { recipeIds: [], removedSourceName: 'x', ts: at.toISOString() },
          })
        : eventType === 'DSAR_REJECTED'
          ? await recordDsarEvent(getDb(), { eventType, caseId, reason: 'fora de escopo' })
          : await recordDsarEvent(getDb(), { eventType, caseId, channel: 'web_form', requestType: 'name_removal' })
    await getDb().update(dsarAuditEvent).set({ createdAt: at }).where(eq(dsarAuditEvent.id, id))
  }

  it('aberto nunca sai; encerrado há menos de 12 meses fica; encerrado há mais sai', async () => {
    const open = await ticket('received', monthsAgo(24))
    const verified = await ticket('verified', monthsAgo(24))
    const closedRecently = await ticket('fulfilled', monthsAgo(13))
    await event(closedRecently, 'DSAR_FULFILLED', monthsAgo(1))
    const rejectedRecently = await ticket('rejected', monthsAgo(13))
    await event(rejectedRecently, 'DSAR_REJECTED', inside(C.resolvedTakedown))
    const noEvent = await ticket('rejected', monthsAgo(13))
    const oldEvent = await ticket('fulfilled', monthsAgo(14))
    await event(oldEvent, 'DSAR_FULFILLED', outside(C.resolvedTakedown))
    const onlyReceivedEvent = await ticket('fulfilled', monthsAgo(13))
    await event(onlyReceivedEvent, 'DSAR_RECEIVED', monthsAgo(1)) // não é registro de encerramento
    const receivedRecently = await ticket('fulfilled', inside(C.resolvedTakedown))

    expect(await run('takedownTickets')).toBe(3)

    const left = await ids(getDb().select({ id: takedownTicket.id }).from(takedownTicket))
    expect(left).toEqual([open, verified, closedRecently, rejectedRecently, receivedRecently].sort())
    // Saíram: o encerrado sem registro (vale o recebimento), o de registro velho e o de registro só de recebimento.
    expect(left).not.toContain(noEvent)
    expect(left).not.toContain(oldEvent)
    expect(left).not.toContain(onlyReceivedEvent)
  })
})

describe('auditoria DSAR (5 anos)', () => {
  it('dsarEvents: só o registro com 5 anos ou mais sai', async () => {
    const keep = await recordDsarEvent(getDb(), { eventType: 'DSAR_RECEIVED', channel: 'web_form', requestType: 'x' })
    const drop = await recordDsarEvent(getDb(), { eventType: 'DSAR_RECEIVED', channel: 'web_form', requestType: 'x' })
    await getDb().update(dsarAuditEvent).set({ createdAt: inside(C.dsarAudit) }).where(eq(dsarAuditEvent.id, keep))
    await getDb().update(dsarAuditEvent).set({ createdAt: outside(C.dsarAudit) }).where(eq(dsarAuditEvent.id, drop))

    expect(await run('dsarEvents')).toBe(1)
    expect(await ids(getDb().select({ id: dsarAuditEvent.id }).from(dsarAuditEvent))).toEqual([keep])
  })
})

describe('cascos de criação (24 meses)', () => {
  async function sessionOf(userId: string, createdAt: Date, mode: 'structured' | 'conversation' = 'structured') {
    const briefingId = mode === 'structured' ? await seedBriefing() : null
    if (briefingId) await getDb().update(briefing).set({ createdAt }).where(eq(briefing.id, briefingId))
    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId, mode, briefingId, createdAt, updatedAt: createdAt })
      .returning({ id: creationSession.id })
    return { id: cs.id, briefingId }
  }
  async function gen(creationSessionId: string, createdAt: Date) {
    const [g] = await getDb()
      .insert(generation)
      .values({
        creationSessionId,
        outcome: 'impossible',
        model: 'claude-opus-4-8',
        schemaVersion: SCHEMA_VERSION_RECEITA,
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: '0.012345',
        createdAt,
      })
      .returning({ id: generation.id })
    return g.id
  }
  async function runInOrder(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const s of RETENTION_STEPS) out[s.key] = await s.run(getDb(), NOW)
    return out
  }

  it('conta ELIMINADA: geração velha sai por linha, a sessão sem geração sai, o briefing sem sessão sai; o resto fica', async () => {
    const erased = await seedUser({ email: 'eliminada@ret.test' })
    await getDb().update(users).set({ anonymizedAt: monthsAgo(30), deletedAt: monthsAgo(30) }).where(eq(users.id, erased))
    // Sessão velha com uma geração velha: tudo sai (sessão estruturada ⇒ o briefing também).
    const s1 = await sessionOf(erased, outside(C.usageLedger))
    await gen(s1.id, outside(C.usageLedger))
    // Sessão velha regenerada há 1 mês: a geração velha sai, a nova e a sessão ficam.
    const s2 = await sessionOf(erased, outside(C.usageLedger))
    await gen(s2.id, outside(C.usageLedger))
    const g2new = await gen(s2.id, monthsAgo(1))
    // Sessão dentro do prazo: fica.
    const s3 = await sessionOf(erased, inside(C.usageLedger), 'conversation')
    const g3 = await gen(s3.id, inside(C.usageLedger))
    // Briefing sem sessão: o velho sai, o novo fica.
    const orphanOld = await seedBriefing()
    await getDb().update(briefing).set({ createdAt: outside(C.usageLedger) }).where(eq(briefing.id, orphanOld))
    const orphanNew = await seedBriefing()

    const out = await runInOrder()
    expect(out).toMatchObject({ erasedGenerations: 2, erasedCreationSessions: 1, orphanBriefings: 2 })

    expect(await ids(getDb().select({ id: generation.id }).from(generation))).toEqual([g2new, g3].sort())
    expect(await ids(getDb().select({ id: creationSession.id }).from(creationSession))).toEqual([s2.id, s3.id].sort())
    expect(await ids(getDb().select({ id: briefing.id }).from(briefing))).toEqual([s2.briefingId!, orphanNew].sort())
    expect(await ids(getDb().select({ id: briefing.id }).from(briefing).where(inArray(briefing.id, [s1.briefingId!, orphanOld])))).toEqual([])
  })

  it('conta VIVA: a geração fica (histórico), tokens e custo viram NULL aos 24 meses', async () => {
    const live = await seedUser({ email: 'viva@ret.test' })
    const s = await sessionOf(live, outside(C.usageLedger))
    const old = await gen(s.id, outside(C.usageLedger))
    const recent = await gen(s.id, inside(C.usageLedger))

    const out = await runInOrder()
    expect(out).toMatchObject({ erasedGenerations: 0, erasedCreationSessions: 0, orphanBriefings: 0, liveGenerationCosts: 1 })

    const rows = await getDb()
      .select({ id: generation.id, i: generation.inputTokens, o: generation.outputTokens, c: generation.costUsd })
      .from(generation)
      .orderBy(generation.createdAt)
    expect(rows).toEqual([
      { id: old, i: null, o: null, c: null },
      { id: recent, i: 1000, o: 500, c: '0.012345' },
    ])
    expect(await ids(getDb().select({ id: creationSession.id }).from(creationSession))).toEqual([s.id])
  })
})

describe('lotes, orçamento e idempotência', () => {
  async function seedOldImageGenerations(n: number): Promise<void> {
    const u = await seedUser({ email: `lote-${crypto.randomUUID()}@ret.test` })
    await getDb()
      .insert(imageGeneration)
      .values(Array.from({ length: n }, () => ({ userId: u, createdAt: outside(C.usageLedger) })))
  }

  it('`batch: 2`, `maxBatches: 2` com 5 linhas apaga 4; a passada seguinte leva a última', async () => {
    await seedOldImageGenerations(5)
    expect(await run('imageGenerations', { batch: 2, maxBatches: 2 })).toBe(4)
    expect(await run('imageGenerations', { batch: 2, maxBatches: 2 })).toBe(1)
  })

  it('orçamento esgotado: o lote em curso termina e nenhum lote novo começa', async () => {
    await seedOldImageGenerations(5)
    expect(await run('imageGenerations', { batch: 2, budget: { exhausted: () => true } })).toBe(2)
  })

  it('deleteInBatches para no lote incompleto', async () => {
    const calls: number[] = []
    const total = await deleteInBatches(
      async (limit) => {
        calls.push(limit)
        return calls.length === 1 ? limit : 1
      },
      { batch: 3, maxBatches: 10 },
    )
    expect([total, calls]).toEqual([4, [3, 3]])
  })

  it('idempotente: a 2ª passada não acha nada', async () => {
    const u = await seedUser({ email: 'idem@ret.test' })
    await getDb().insert(imageGeneration).values({ userId: u, createdAt: outside(C.usageLedger) })
    await getDb().insert(session).values({ userId: u, token: 't', expiresAt: new Date(NOW.getTime() - 1000) })
    for (const s of RETENTION_STEPS) await s.run(getDb(), NOW)
    for (const s of RETENTION_STEPS) expect(await s.run(getDb(), NOW), s.key).toBe(0)
  })
})

describe('GET /api/cron/retention', () => {
  const original = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = 'segredo-de-teste'
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })
  const call = (headers: Record<string, string> = { authorization: 'Bearer segredo-de-teste' }) =>
    GET(new Request('http://localhost/api/cron/retention', { headers }))

  it('sem secret / header errado → 401 e nada roda', async () => {
    const spy = vi.spyOn(step('sessions'), 'run')
    expect((await call({})).status).toBe(401)
    expect((await call({ authorization: 'Bearer errado' })).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call()).status).toBe(401)
    expect(spy).not.toHaveBeenCalled()
  })

  it('banco vazio → 200 e UMA linha [retencao] com todas as contagens', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(200)
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[retencao]'))
    expect(lines).toEqual([
      '[retencao] passada concluída: imageGenerations=0 mealPlanSuggestions=0 extractionEvents=0 sessions=0 verifications=0 takedownTickets=0 dsarEvents=0 erasedGenerations=0 erasedCreationSessions=0 orphanBriefings=0 liveGenerationCosts=0',
    ])
    expect(await res.json()).toMatchObject({ sessions: 0, liveGenerationCosts: 0 })
  })

  it('um passo lança → os outros rodam, 500, linha de erro com nome e warn "com falha" sem a chave dele', async () => {
    vi.spyOn(step('imageGenerations'), 'run').mockRejectedValue(new Error('banco fora com segredo'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const u = await seedUser({ email: 'rota@ret.test' })
    await getDb().insert(session).values({ userId: u, token: 't', expiresAt: new Date(Date.now() - 1000) })

    const res = await call()
    expect(res.status).toBe(500)
    expect(error.mock.calls).toEqual([['[retencao] registros de geração de imagem falhou: erro=Error']])
    expect(warn).toHaveBeenCalledWith(
      '[retencao] passada com falha: mealPlanSuggestions=0 extractionEvents=0 sessions=1 verifications=0 takedownTickets=0 dsarEvents=0 erasedGenerations=0 erasedCreationSessions=0 orphanBriefings=0 liveGenerationCosts=0',
    )
  })

  it('orçamento esgotado antes do 1º passo → 200, nada roda e a linha diz quantos passos ficaram para amanhã', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1_000_000)
    const spy = vi.spyOn(step('imageGenerations'), 'run')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    const res = await call()
    expect(res.status).toBe(200)
    expect(spy).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith(`[retencao] passada concluída: deferredSteps=${RETENTION_STEPS.length}`)
  })
})
