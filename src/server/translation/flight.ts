import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeTranslation, recipeTranslationAttempt } from '@/db/schema'
import { QUOTA_LOCK_CLASS, reserveQuotaHoldInTx } from '@/server/quota/atomic'
import { pgCode } from '@/server/recipe/visibility'
import {
  TRANSLATION_FAILURE_COOLDOWN_MS,
  TRANSLATION_INFRA_FAILURE_COOLDOWN_MS,
  TRANSLATION_LEASE_MS,
  TRANSLATION_PAIR_LOCK_TIMEOUT_MS,
  TRANSLATION_USER_LOCK_TIMEOUT_MS,
  decideTranslationFlight,
} from '@/domain/translation-flight'

/**
 * Single-flight e cache negativo da tradução sob demanda (#642, ADR-0056), sobre a tabela
 * `recipe_translation_attempt` (uma linha por (receita, locale) ainda sem tradução).
 *
 * `claimTranslationFlight` roda numa tx CURTA: advisory lock do par → lê o estado → reserva a cota do usuário (se
 * houver) → grava o lease. A chamada ao modelo acontece DEPOIS do commit, sem lock nem tx abertos (mesmo motivo
 * da reserva de cota do ADR-0055: uma lock segurada pelos 10–50 s da chamada prenderia uma conexão do pool por
 * pedido). O lease é o "em voo": vence sozinho em `TRANSLATION_LEASE_MS` se a função morrer no meio.
 *
 * Os três fechamentos (`completeTranslationFlight`, `failTranslationFlight`, `abandonTranslationFlight`) só agem se
 * o lease ainda é DESTE pedido (`lease_id`): um voo que demorou além do lease e foi substituído não apaga nem
 * sobrescreve o estado do voo seguinte.
 */

/** Usuário e teto da cota de tradução. Ausente = chamada interna (sem cota; single-flight e cache valem igual). */
export type TranslationQuota = { userId: string; cap: number }

export type TranslationFlightClaim =
  | { kind: 'claimed'; leaseId: string }
  | { kind: 'exists' }
  | { kind: 'in_progress' }
  | { kind: 'cooling_down' }

/** SQLSTATE `lock_not_available`: o `lock_timeout` estourou esperando a lock do par. */
const LOCK_NOT_AVAILABLE = '55P03'

function pairWhere(recipeId: string, locale: string) {
  return and(eq(recipeTranslationAttempt.recipeId, recipeId), eq(recipeTranslationAttempt.locale, locale))
}

/** Intervalo SQL de `ms` milissegundos (somado ao `now()` do banco: o relógio é um só entre instâncias). */
function msInterval(ms: number) {
  return sql`(${ms}::double precision * interval '1 millisecond')`
}

/** A espera pela lock do PAR estourou: sinal interno, lançado de dentro da tx (o 55P03 já a abortou). */
class PairLockBusy extends Error {}

/**
 * Tenta tomar o voo da tradução de (receita, locale).
 *  - A espera pela lock do PAR passou de `TRANSLATION_PAIR_LOCK_TIMEOUT_MS` ⇒ `in_progress`: outro pedido está
 *    decidindo esse par agora (quem espera é um terceiro, e o 200 no original é a resposta certa, não um 429).
 *  - LANÇA `QuotaExceededError` quando a cota do usuário estourou ou quando a espera pela lock DO USUÁRIO passou de
 *    `TRANSLATION_USER_LOCK_TIMEOUT_MS` (rajada do mesmo usuário). Nos dois casos a tx reverte e nada é gravado
 *    (nem lease, nem reserva).
 *
 * Ordem das locks fixa (par → usuário), sempre a mesma em todo pedido: sem deadlock. As duas esperas são curtas
 * (~2 s cada): a do usuário acontece com a lock do par tomada, e as duas somadas correm antes do prazo de 50 s do
 * tradutor, dentro do `maxDuration = 60` da rota. A reserva de cota só acontece quando o pedido VAI chamar o modelo
 * (`go`): tradução já gravada, em voo ou em cooldown não gasta slot.
 */
export async function claimTranslationFlight(
  db: Database,
  input: { recipeId: string; locale: string; failKey: string; quota?: TranslationQuota },
): Promise<TranslationFlightClaim> {
  try {
    return await claimInTx(db, input)
  } catch (e) {
    if (e instanceof PairLockBusy) return { kind: 'in_progress' }
    throw e
  }
}

async function claimInTx(
  db: Database,
  input: { recipeId: string; locale: string; failKey: string; quota?: TranslationQuota },
): Promise<TranslationFlightClaim> {
  const { recipeId, locale, failKey, quota } = input
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lock_timeout', ${`${TRANSLATION_PAIR_LOCK_TIMEOUT_MS}ms`}, true)`)
    try {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${QUOTA_LOCK_CLASS.translationFlight}::int, hashtext(${`${recipeId}:${locale}`}))`,
      )
    } catch (e) {
      // Lançar (e não devolver) é obrigatório: o 55P03 abortou a tx, e seguir nela faria o COMMIT falhar.
      if (pgCode(e) === LOCK_NOT_AVAILABLE) throw new PairLockBusy()
      throw e
    }
    await tx.execute(sql`set local lock_timeout to default`)

    // Sob a lock, a tradução gravada por um voo anterior já está visível (ele commitou antes de soltar).
    const [existing] = await tx
      .select({ id: recipeTranslation.id })
      .from(recipeTranslation)
      .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
    const [state] = await tx
      .select({
        leaseActive: sql<boolean>`coalesce(${recipeTranslationAttempt.leaseUntil} > now(), false)`,
        cooldownActive: sql<boolean>`coalesce(${recipeTranslationAttempt.retryAt} > now(), false)`,
        failKey: recipeTranslationAttempt.failKey,
      })
      .from(recipeTranslationAttempt)
      .where(pairWhere(recipeId, locale))

    const decision = decideTranslationFlight({
      translationExists: existing != null,
      leaseActive: state?.leaseActive ?? false,
      cooldownActive: state?.cooldownActive ?? false,
      storedFailKey: state?.failKey ?? null,
      currentFailKey: failKey,
    })
    if (decision !== 'go') return { kind: decision }

    // Cota do usuário (ADR-0056): a reserva nasce cobrada e nunca volta — é o registro da tradução disparada.
    // A espera pela lock do usuário estourada vira `QuotaExceededError(DERIVE_LOCK_BUSY_RETRY_MS)` lá dentro (429).
    if (quota) {
      await reserveQuotaHoldInTx(tx, {
        userId: quota.userId,
        kind: 'translation',
        cap: quota.cap,
        lockTimeoutMs: TRANSLATION_USER_LOCK_TIMEOUT_MS,
      })
    }

    const leaseId = randomUUID()
    const leaseUntil = sql`now() + ${msInterval(TRANSLATION_LEASE_MS)}`
    await tx
      .insert(recipeTranslationAttempt)
      .values({ recipeId, locale, leaseId, leaseUntil, updatedAt: sql`now()` })
      .onConflictDoUpdate({
        target: [recipeTranslationAttempt.recipeId, recipeTranslationAttempt.locale],
        // O cache negativo antigo fica (só não vale mais para esta chave); a próxima falha o sobrescreve.
        set: { leaseId, leaseUntil, updatedAt: sql`now()` },
      })
    return { kind: 'claimed', leaseId }
  })
}

/**
 * Sucesso: a tradução foi gravada, então o estado do par não serve mais (o próximo POST responde `exists`, que o
 * claim checa antes do lease). Best-effort: a tradução já persistiu, e uma linha que sobrar não bloqueia nada.
 */
export async function completeTranslationFlight(
  db: Database,
  input: { recipeId: string; locale: string; leaseId: string },
): Promise<void> {
  try {
    await db
      .delete(recipeTranslationAttempt)
      .where(and(pairWhere(input.recipeId, input.locale), eq(recipeTranslationAttempt.leaseId, input.leaseId)))
  } catch {
    // A linha sobra até a receita sumir (cascade) ou o próximo voo do par (que não acontece: `exists`).
  }
}

/**
 * Falha do tradutor: solta o lease e grava o cache negativo. `rowSpecific` (`UnusableTranslationError`, a saída do
 * modelo não serve para esta fonte) espera `TRANSLATION_FAILURE_COOLDOWN_MS`; infraestrutura espera
 * `TRANSLATION_INFRA_FAILURE_COOLDOWN_MS`. Best-effort: se o UPDATE falhar, o lease vence sozinho e o próximo POST
 * tenta de novo (o mesmo que acontecia antes do #642, limitado pela cota do usuário).
 */
export async function failTranslationFlight(
  db: Database,
  input: { recipeId: string; locale: string; leaseId: string; failKey: string; rowSpecific: boolean },
): Promise<void> {
  const cooldownMs = input.rowSpecific ? TRANSLATION_FAILURE_COOLDOWN_MS : TRANSLATION_INFRA_FAILURE_COOLDOWN_MS
  try {
    await db
      .update(recipeTranslationAttempt)
      .set({
        leaseId: null,
        leaseUntil: null,
        failedAt: sql`now()`,
        retryAt: sql`now() + ${msInterval(cooldownMs)}`,
        failKey: input.failKey,
        updatedAt: sql`now()`,
      })
      .where(and(pairWhere(input.recipeId, input.locale), eq(recipeTranslationAttempt.leaseId, input.leaseId)))
  } catch {
    // Sem cache negativo desta vez; o lease vence em `TRANSLATION_LEASE_MS`.
  }
}

/**
 * Erro inesperado DEPOIS do lease e fora do tradutor (slug, INSERT): solta o lease sem gravar cache negativo, para o
 * próximo POST não esperar o lease vencer. Best-effort: o erro original é o que sobe.
 */
export async function abandonTranslationFlight(
  db: Database,
  input: { recipeId: string; locale: string; leaseId: string },
): Promise<void> {
  try {
    await db
      .update(recipeTranslationAttempt)
      .set({ leaseId: null, leaseUntil: null, updatedAt: sql`now()` })
      .where(and(pairWhere(input.recipeId, input.locale), eq(recipeTranslationAttempt.leaseId, input.leaseId)))
  } catch {
    // O lease vence sozinho.
  }
}
