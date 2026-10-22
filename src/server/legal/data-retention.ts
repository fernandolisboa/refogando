import { and, eq, gte, inArray, isNotNull, isNull, lt, notExists, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Database } from '@/db/client'
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
import { retentionCutoffs, type RetentionCutoffs } from '@/domain/data-retention'
import { RESOLVED_TAKEDOWN_STATUSES } from '@/domain/dsar-sla'
import { purgeDsarEventsBefore } from '@/server/legal/dsar-audit'
import type { TimeBudget } from '@/server/time-budget'

/**
 * Retenção: o que o app apaga sozinho quando o prazo vence (issue #473, ADR-0049; prazos em
 * `@/domain/data-retention`, operações em `docs/legal/registro-de-operacoes.md`). Cada passo apaga em LOTES
 * (`RETENTION_BATCH` linhas por comando, no máximo `RETENTION_MAX_BATCHES` comandos por passada), cada lote
 * no seu próprio autocommit: os passos são independentes e idempotentes, então não há transação em volta e
 * o que saiu fica saído se a função morrer no meio. O cron (`/api/cron/retention`) roda os passos na ordem
 * de `RETENTION_STEPS` e para de começar lote/passo novo quando o orçamento de tempo acaba; o resto sai na
 * passada do dia seguinte.
 *
 * Os passos:
 *  - Registros de uso de IA (24 meses): `image_generation`, `meal_plan_suggestion_event` (as cotas leem só
 *    24 h); `extraction_event` (30 dias).
 *  - Sessões vencidas (o IP e o navegador vão junto) e `verification` vencida (as lápides do cadastro
 *    expurgado vencem em 90 dias e ficam até lá; toda leitura de `verification` já exige `expires_at` futuro).
 *  - Ticket de takedown ENCERRADO há 12 meses: status resolvido, recebido antes do corte e sem registro de
 *    atendimento/recusa (`DSAR_FULFILLED`/`DSAR_REJECTED` com `case_id` do ticket) depois do corte. Sem coluna
 *    de encerramento, o último registro da auditoria é a data de encerramento; sem registro, o recebimento.
 *    Ticket aberto nunca sai.
 *  - Auditoria DSAR com 5 anos (`purgeDsarEventsBefore`, o único DELETE dela).
 *  - Os cascos das sessões de criação de conta ELIMINADA (a limpeza da eliminação deixou só modelo, tokens e
 *    custo): a `generation` com 24 meses (por linha — a regeneração reusa a sessão), depois a sessão sem
 *    nenhuma geração restante (a Transcrição cai em cascata) e o Briefing que ficou sem sessão. Nessa ordem:
 *    o Briefing só sai quando nenhuma sessão aponta para ele, então o CHECK do modo estruturado nunca dispara.
 *  - Conta VIVA: a `generation` fica (é o histórico de criação da pessoa), mas tokens e custo viram NULL aos
 *    24 meses (o registro de uso é a parte que vence).
 *
 * Os cortes usam o `now` injetado e operadores tipados (nada de `Date` dentro de `sql` cru).
 */

/** Linhas por comando de DELETE/UPDATE. */
export const RETENTION_BATCH = 5000
/** Comandos por passo numa passada (até 50 mil linhas por passo por dia). */
export const RETENTION_MAX_BATCHES = 10
/** Orçamento de tempo da passada: abaixo do `maxDuration = 60` da rota, com folga. */
export const RETENTION_BUDGET_MS = 40_000
/** Não começa lote nem passo novo com menos que isto do orçamento (um lote de 5000 leva bem menos). */
export const RETENTION_RESERVE_MS = 15_000

export type RetentionStepOpts = { batch?: number; maxBatches?: number; budget?: TimeBudget }

/**
 * Repete `run(limit)` enquanto o lote vier cheio, até `maxBatches` vezes, e para entre lotes quando o
 * orçamento acaba. Devolve o total.
 */
export async function deleteInBatches(
  run: (limit: number) => Promise<number>,
  opts: RetentionStepOpts = {},
): Promise<number> {
  const batch = opts.batch ?? RETENTION_BATCH
  const maxBatches = opts.maxBatches ?? RETENTION_MAX_BATCHES
  let total = 0
  for (let i = 0; i < maxBatches; i++) {
    if (i > 0 && opts.budget && !opts.budget.canStartMore()) break
    const n = await run(batch)
    total += n
    if (n < batch) break
  }
  return total
}

/** Lotes de `DELETE FROM t WHERE id IN (SELECT id FROM t WHERE pred LIMIT n)`. */
function deleteWhere(
  db: Database,
  table: PgTable,
  id: AnyPgColumn,
  pred: SQL,
  opts: RetentionStepOpts,
): Promise<number> {
  return deleteInBatches(async (limit) => {
    const due = db.select({ id }).from(table).where(pred).limit(limit)
    const deleted = await db.delete(table).where(inArray(id, due)).returning({ id })
    return deleted.length
  }, opts)
}

/** A sessão de criação é de conta eliminada (`anonymized_at` não nulo)? */
const sessionOfErased = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${creationSession.userId} AND ${users.anonymizedAt} IS NOT NULL)`

export type RetentionStep = {
  /** Chave da linha `[retencao]` e do corpo do cron. */
  key: string
  /** Nome do passo na linha de falha. */
  label: string
  run(db: Database, now: Date, opts?: RetentionStepOpts): Promise<number>
}

const cut = (now: Date): RetentionCutoffs => retentionCutoffs(now)

/** Os passos, NA ORDEM em que o cron os roda (a ordem dos cascos importa — doc do módulo). */
export const RETENTION_STEPS: readonly RetentionStep[] = [
  {
    key: 'imageGenerations',
    label: 'registros de geração de imagem',
    run: (db, now, opts = {}) =>
      deleteWhere(db, imageGeneration, imageGeneration.id, lt(imageGeneration.createdAt, cut(now).usageLedger), opts),
  },
  {
    key: 'mealPlanSuggestions',
    label: 'registros de Sugestão de cardápio',
    run: (db, now, opts = {}) =>
      deleteWhere(
        db,
        mealPlanSuggestionEvent,
        mealPlanSuggestionEvent.id,
        lt(mealPlanSuggestionEvent.createdAt, cut(now).usageLedger),
        opts,
      ),
  },
  {
    key: 'extractionEvents',
    label: 'registros de extração',
    run: (db, now, opts = {}) =>
      deleteWhere(db, extractionEvent, extractionEvent.id, lt(extractionEvent.createdAt, cut(now).extractionEvent), opts),
  },
  {
    key: 'sessions',
    label: 'sessões vencidas',
    run: (db, now, opts = {}) => deleteWhere(db, session, session.id, lt(session.expiresAt, now), opts),
  },
  {
    key: 'verifications',
    label: 'verificações vencidas',
    run: (db, now, opts = {}) => deleteWhere(db, verification, verification.id, lt(verification.expiresAt, now), opts),
  },
  {
    key: 'takedownTickets',
    label: 'tickets de takedown encerrados',
    run: (db, now, opts = {}) => {
      const c = cut(now).resolvedTakedown
      const closedAfterCutoff = db
        .select({ one: sql`1` })
        .from(dsarAuditEvent)
        .where(
          and(
            eq(dsarAuditEvent.caseId, takedownTicket.id),
            inArray(dsarAuditEvent.eventType, ['DSAR_FULFILLED', 'DSAR_REJECTED']),
            gte(dsarAuditEvent.createdAt, c),
          ),
        )
      return deleteWhere(
        db,
        takedownTicket,
        takedownTicket.id,
        and(
          inArray(takedownTicket.status, [...RESOLVED_TAKEDOWN_STATUSES]),
          lt(takedownTicket.receivedAt, c),
          notExists(closedAfterCutoff),
        )!,
        opts,
      )
    },
  },
  {
    key: 'dsarEvents',
    label: 'auditoria DSAR',
    run: (db, now, opts = {}) =>
      deleteInBatches((limit) => purgeDsarEventsBefore(db, cut(now).dsarAudit, limit), opts),
  },
  {
    key: 'erasedGenerations',
    label: 'gerações de contas eliminadas',
    run: (db, now, opts = {}) => {
      const erasedSessions = db.select({ id: creationSession.id }).from(creationSession).where(sessionOfErased)
      return deleteWhere(
        db,
        generation,
        generation.id,
        and(lt(generation.createdAt, cut(now).usageLedger), inArray(generation.creationSessionId, erasedSessions))!,
        opts,
      )
    },
  },
  {
    key: 'erasedCreationSessions',
    label: 'sessões de criação de contas eliminadas',
    run: (db, now, opts = {}) =>
      deleteWhere(
        db,
        creationSession,
        creationSession.id,
        and(
          lt(creationSession.createdAt, cut(now).usageLedger),
          sessionOfErased,
          sql`NOT EXISTS (SELECT 1 FROM ${generation} WHERE ${generation.creationSessionId} = ${creationSession.id})`,
        )!,
        opts,
      ),
  },
  {
    key: 'orphanBriefings',
    label: 'briefings sem sessão',
    // `creation_session.briefing_id` é a ÚNICA FK para `briefing` (o `briefing_item` é filho em cascata).
    run: (db, now, opts = {}) =>
      deleteWhere(
        db,
        briefing,
        briefing.id,
        and(
          lt(briefing.createdAt, cut(now).usageLedger),
          sql`NOT EXISTS (SELECT 1 FROM ${creationSession} WHERE ${creationSession.briefingId} = ${briefing.id})`,
        )!,
        opts,
      ),
  },
  {
    key: 'liveGenerationCosts',
    label: 'tokens e custo de gerações de contas vivas',
    run: (db, now, opts = {}) =>
      deleteInBatches(async (limit) => {
        const liveSessions = db
          .select({ id: creationSession.id })
          .from(creationSession)
          .innerJoin(users, eq(users.id, creationSession.userId))
          .where(isNull(users.anonymizedAt))
        const due = db
          .select({ id: generation.id })
          .from(generation)
          .where(
            and(
              lt(generation.createdAt, cut(now).usageLedger),
              or(isNotNull(generation.inputTokens), isNotNull(generation.outputTokens), isNotNull(generation.costUsd)),
              inArray(generation.creationSessionId, liveSessions),
            ),
          )
          .limit(limit)
        const cleared = await db
          .update(generation)
          .set({ inputTokens: null, outputTokens: null, costUsd: null })
          .where(inArray(generation.id, due))
          .returning({ id: generation.id })
        return cleared.length
      }, opts),
  },
]
