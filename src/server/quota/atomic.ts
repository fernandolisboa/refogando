import { and, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { creationSession, extractionEvent, generation, imageGeneration } from '@/db/schema'
import { RECIPE_GEN_WINDOW_MS, decideRecipeGenQuota } from '@/domain/recipe-gen-quota'
import { IMAGE_GEN_WINDOW_MS, decideImageQuota } from '@/domain/image-quota'

/**
 * Gate ATÔMICO de cota de geração por IA (#446) — fecha a corrida TOCTOU do teto.
 *
 * O teto (recipe-gen #167, image-gen #132) era aplicado como read-then-act NÃO-atômico: um SELECT de
 * contagem (loadRecentRecipeGenAt / loadRecentAiGenAt) → decisão pura → mais tarde um INSERT, SEM lock.
 * Sob READ COMMITTED (Neon/Postgres), N requisições concorrentes do MESMO usuário lêem a contagem estale,
 * TODAS passam o cap e TODAS pagam o modelo. O pré-check nas rotas continua (early-reject barato que
 * poupa a chamada paga no caso claramente-acima-do-teto), mas a ENFORCEMENT real vive aqui:
 *
 *   DENTRO da MESMA transação que faz o INSERT de persistência:
 *     1. `SELECT pg_advisory_xact_lock(classId, hashtext(userId))` — serializa as requisições do MESMO
 *        usuário (a lock auto-libera no fim da tx, commit ou rollback). Usuários distintos ⇒ chaves
 *        distintas ⇒ sem contenção. O `classId` separa o domínio receita×imagem (nunca cross-block).
 *     2. reconta os eventos na janela 24h (agora vendo TODOS os commits anteriores, pois a lock serializou).
 *     3. decide pela função pura (mesma de sempre — fonte única do cálculo).
 *     4. estourou ⇒ LANÇA `QuotaExceededError` (a tx reverte, NADA persiste) → o caller mapeia p/ 429.
 *
 * Assim o cap segura em EXATAMENTE o limite mesmo sob Promise.all de N inserts simultâneos: só
 * `cap - contagemAtual` transações passam a recontagem sob a lock; as demais revertem com 429.
 *
 * MESMO idioma do `FOR UPDATE` já usado em moderação/curadoria/coleções — serializar o read-then-write
 * dentro de UMA transação — só que a chave é o USUÁRIO (advisory lock), não uma linha específica.
 */

/** Tipo da transação do Drizzle (mesmas APIs de query que `Database`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Namespaces (classId) fixos do `pg_advisory_xact_lock` de 2 args — um por DOMÍNIO de cota, para que a
 * lock de geração de RECEITA e a de IMAGEM nunca se bloqueiem mutuamente (chaves de espaços distintos).
 * Valores arbitrários porém ESTÁVEIS (mudá-los invalidaria locks em voo num deploy — mantê-los fixos).
 */
export const QUOTA_LOCK_CLASS = { recipeGen: 4671, imageGen: 4672, extraction: 4673 } as const

/**
 * Cota estourada detectada ATOMICAMENTE dentro da tx (após a lock + recontagem). Carrega o countdown
 * (`retryAfterMs`) da função pura de decisão. LANÇADA de dentro da transação de persistência ⇒ a tx
 * REVERTE (nada é gravado) e o caller a captura para responder 429. É um desfecho ESPERADO (corrida),
 * NÃO um erro de sistema — por isso um tipo próprio, distinguível de qualquer outra falha.
 */
export class QuotaExceededError extends Error {
  readonly retryAfterMs: number
  constructor(retryAfterMs: number) {
    super('quota_exceeded')
    this.name = 'QuotaExceededError'
    this.retryAfterMs = retryAfterMs
  }
}

/** Toma o advisory xact lock por (classId, hashtext(userId)) DENTRO da tx. Auto-libera no fim da tx. */
async function acquireUserQuotaLock(tx: Tx, classId: number, userId: string): Promise<void> {
  // 2 args int4: classId (namespace do domínio) + hashtext(userId) (uuid → int4). hashtext é built-in
  // do Postgres. Colisões de hash entre userIds só serializam a mais (correção preservada, custo raro).
  await tx.execute(sql`select pg_advisory_xact_lock(${classId}::int, hashtext(${userId}))`)
}

/**
 * Gate ATÔMICO da cota de geração de RECEITA (#167), DENTRO da tx corrente e SOB a advisory lock do
 * usuário: reconta as `generation` na janela 24h (via `creation_session.user_id`, mesma fonte de
 * `loadRecentRecipeGenAt`) e decide por `decideRecipeGenQuota`. Estourou ⇒ LANÇA `QuotaExceededError`.
 * DEVE ser a PRIMEIRA operação da transação de persistência (antes de qualquer INSERT). `cap` não-finito
 * (papel ∞) ⇒ no-op (nem toma a lock — não serializa admin à toa).
 */
export async function assertRecipeGenSlotInTx(
  tx: Tx,
  input: { userId: string; cap: number },
): Promise<void> {
  const { userId, cap } = input
  if (!Number.isFinite(cap)) return
  const now = new Date()
  await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.recipeGen, userId)
  const since = new Date(now.getTime() - RECIPE_GEN_WINDOW_MS)
  const rows = await tx
    .select({ createdAt: generation.createdAt })
    .from(generation)
    .innerJoin(creationSession, eq(generation.creationSessionId, creationSession.id))
    .where(and(eq(creationSession.userId, userId), gte(generation.createdAt, since)))
  const decision = decideRecipeGenQuota({ cap, recentAt: rows.map((r) => r.createdAt), now })
  if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
}

/**
 * Gate ATÔMICO da cota de geração de IMAGEM (#132/#134), DENTRO da tx corrente e SOB a advisory lock do
 * usuário: reconta os eventos do LEDGER imutável `image_generation` na janela 24h (mesma fonte de
 * `loadRecentAiGenAt`) e decide por `decideImageQuota`. Estourou ⇒ LANÇA `QuotaExceededError`. DEVE ser
 * a PRIMEIRA operação da tx que insere a `recipe_image` + o ledger. `cap` não-finito (∞) ⇒ no-op.
 */
export async function assertImageGenSlotInTx(
  tx: Tx,
  input: { userId: string; cap: number },
): Promise<void> {
  const { userId, cap } = input
  if (!Number.isFinite(cap)) return
  const now = new Date()
  await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.imageGen, userId)
  const since = new Date(now.getTime() - IMAGE_GEN_WINDOW_MS)
  const rows = await tx
    .select({ createdAt: imageGeneration.createdAt })
    .from(imageGeneration)
    .where(and(eq(imageGeneration.userId, userId), gte(imageGeneration.createdAt, since)))
  const decision = decideImageQuota({ cap, recentAt: rows.map((r) => r.createdAt), now })
  if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
}

/**
 * RESERVA ATÔMICA de um slot de EXTRAÇÃO de ingredientes (#447), fechando a corrida TOCTOU ANTES da
 * chamada ao Claude. Diferente de receita/imagem (que inserem o registro DEPOIS do modelo, na persist),
 * a extração NÃO persiste saída — então RESERVAMOS o slot ANTES: numa ÚNICA transação, toma o advisory
 * lock do usuário, reconta o ledger `extraction_event` na janela 24h, decide (reusa `decideRecipeGenQuota`
 * — janela deslizante idêntica, fonte ÚNICA do cálculo) e, se couber, INSERE a linha do ledger; estourou
 * ⇒ LANÇA `QuotaExceededError` (a tx reverte, nada é gravado) e o Claude NÃO é tocado (custo barrado).
 * Sob concorrência, a lock serializa as requisições do MESMO usuário: só `cap - contagem` reservas passam,
 * as demais revertem com 429. `cap` não-finito (∞ / admin) ⇒ no-op (sem lock, sem linha). O ledger é
 * IMUTÁVEL (uma linha por TENTATIVA; o custo já foi gasto — não "devolve slot").
 */
export async function reserveExtractionSlot(
  db: Database,
  input: { userId: string; cap: number },
): Promise<void> {
  const { userId, cap } = input
  if (!Number.isFinite(cap)) return
  await db.transaction(async (tx) => {
    const now = new Date()
    await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.extraction, userId)
    const since = new Date(now.getTime() - RECIPE_GEN_WINDOW_MS)
    const rows = await tx
      .select({ createdAt: extractionEvent.createdAt })
      .from(extractionEvent)
      .where(and(eq(extractionEvent.userId, userId), gte(extractionEvent.createdAt, since)))
    const decision = decideRecipeGenQuota({ cap, recentAt: rows.map((r) => r.createdAt), now })
    if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
    await tx.insert(extractionEvent).values({ userId })
  })
}
