import { and, eq, gt, gte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  creationSession,
  extractionEvent,
  generation,
  imageGeneration,
  mealPlanSuggestionEvent,
  quotaHold,
  recipe,
} from '@/db/schema'
import { RECIPE_GEN_WINDOW_MS, decideRecipeGenQuota } from '@/domain/recipe-gen-quota'
import { IMAGE_GEN_WINDOW_MS, decideImageQuota } from '@/domain/image-quota'
import { errorLogFields } from '@/domain/error-report'
import { pgCode } from '@/server/recipe/visibility'

/**
 * Gate ATÔMICO de cota de geração por IA (#446) — fecha a corrida TOCTOU do teto. Guarda também o teto
 * anti-abuso de Derivar/Clonar (#588; não é IA, mas é o mesmo read-then-insert por usuário).
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
 *        distintas ⇒ sem contenção. O `classId` separa as locks por domínio (nunca cross-block).
 *     2. reconta os eventos na janela 24h (agora vendo TODOS os commits anteriores, pois a lock serializou).
 *     3. decide pela função pura (mesma de sempre — fonte única do cálculo).
 *     4. estourou ⇒ LANÇA `QuotaExceededError` (a tx reverte, NADA persiste) → o caller mapeia p/ 429.
 *
 * Assim o cap segura em EXATAMENTE o limite mesmo sob Promise.all de N inserts simultâneos: só
 * `cap - contagemAtual` transações passam a recontagem sob a lock; as demais revertem com 429.
 *
 * MESMO idioma do `FOR UPDATE` já usado em moderação/curadoria/coleções — serializar o read-then-write
 * dentro de UMA transação — só que a chave é o USUÁRIO (advisory lock), não uma linha específica.
 *
 * #640/#641 (ADR-0055): o gate no persist sozinho fechava o TETO, mas não o CUSTO — os M pedidos paralelos já
 * tinham pago o provedor quando chegavam a ele. Receita e imagem agora RESERVAM o slot antes da chamada paga
 * (`reserveQuotaHold`, linha em `quota_hold` sob a mesma lock), e os gates contam as reservas ativas junto com
 * os eventos e CONSOMEM a do próprio pedido (`consumeHoldId`).
 */

/** Tipo da transação do Drizzle (mesmas APIs de query que `Database`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Namespaces (classId) fixos do `pg_advisory_xact_lock` de 2 args — um por DOMÍNIO de cota, para que a
 * lock de geração de RECEITA e a de IMAGEM nunca se bloqueiem mutuamente (chaves de espaços distintos).
 * Valores arbitrários porém ESTÁVEIS (mudá-los invalidaria locks em voo num deploy — mantê-los fixos).
 */
export const QUOTA_LOCK_CLASS = {
  recipeGen: 4671,
  imageGen: 4672,
  extraction: 4673,
  menuSuggestion: 4674,
  derive: 4675,
  report: 4676, // #605: dedupe + teto diário de denúncias de receita (`createReport`), não é IA.
} as const

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

/** Os dois tipos de RESERVA de cota (`quota_hold.kind`, ADR-0055): geração de receita e de imagem. */
export type QuotaHoldKind = 'recipe_gen' | 'image_gen'

/** Por tipo: a classe da lock (a MESMA do gate do persist, pra serializar com ele) e a janela da cota. */
const HOLD_KIND = {
  recipe_gen: { lockClass: QUOTA_LOCK_CLASS.recipeGen, windowMs: RECIPE_GEN_WINDOW_MS },
  image_gen: { lockClass: QUOTA_LOCK_CLASS.imageGen, windowMs: IMAGE_GEN_WINDOW_MS },
} as const satisfies Record<QuotaHoldKind, { lockClass: number; windowMs: number }>

/**
 * Reservas ATIVAS (`expires_at > now`) do usuário no `kind`, como instantes para a decisão pura: cada reserva
 * entra `slots` vezes com o seu `created_at`. Como `expires_at = created_at + janela`, a reserva sai da janela
 * da decisão exatamente quando vence — `decideRecipeGenQuota`/`decideImageQuota` calculam o `retryAfterMs`
 * certo sem mudar. Fonte ÚNICA das reservas que contam (gates e reserva).
 */
async function activeHoldTimes(tx: Tx, userId: string, kind: QuotaHoldKind, now: Date): Promise<Date[]> {
  const rows = await tx
    .select({ createdAt: quotaHold.createdAt, slots: quotaHold.slots })
    .from(quotaHold)
    .where(and(eq(quotaHold.userId, userId), eq(quotaHold.kind, kind), gt(quotaHold.expiresAt, now)))
  return rows.flatMap((r) => Array.from({ length: r.slots }, () => r.createdAt))
}

/** `generation` do usuário na janela 24h (via `creation_session.user_id`, mesma fonte de `loadRecentRecipeGenAt`). */
async function recentRecipeGenTimes(tx: Tx, userId: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - RECIPE_GEN_WINDOW_MS)
  const rows = await tx
    .select({ createdAt: generation.createdAt })
    .from(generation)
    .innerJoin(creationSession, eq(generation.creationSessionId, creationSession.id))
    .where(and(eq(creationSession.userId, userId), gte(generation.createdAt, since)))
  return rows.map((r) => r.createdAt)
}

/** Eventos do LEDGER imutável `image_generation` do usuário na janela 24h (mesma fonte de `loadRecentAiGenAt`). */
async function recentImageGenTimes(tx: Tx, userId: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - IMAGE_GEN_WINDOW_MS)
  const rows = await tx
    .select({ createdAt: imageGeneration.createdAt })
    .from(imageGeneration)
    .where(and(eq(imageGeneration.userId, userId), gte(imageGeneration.createdAt, since)))
  return rows.map((r) => r.createdAt)
}

/** Apaga a reserva `holdId` DENTRO da tx (consumo: o evento gravado nesta tx passa a contar no lugar dela). */
async function deleteHoldInTx(tx: Tx, holdId: string): Promise<void> {
  await tx.delete(quotaHold).where(eq(quotaHold.id, holdId))
}

/**
 * Gate ATÔMICO da cota de geração de RECEITA (#167), DENTRO da tx corrente e SOB a advisory lock do
 * usuário: reconta as `generation` na janela 24h (via `creation_session.user_id`, mesma fonte de
 * `loadRecentRecipeGenAt`) MAIS as reservas ativas de OUTROS pedidos (ADR-0055) e decide por
 * `decideRecipeGenQuota`. Estourou ⇒ LANÇA `QuotaExceededError`. DEVE ser a PRIMEIRA operação da transação
 * de persistência (antes de qualquer INSERT). `cap` não-finito (papel ∞) ⇒ no-op (nem toma a lock — não
 * serializa admin à toa).
 *
 * `consumeHoldId` (ADR-0055): a reserva que ESTE pedido tomou antes de chamar o Claude. Ordem fixa: lock
 * PRIMEIRO, depois o DELETE da própria reserva (consumida: a `generation` desta tx conta no lugar dela), depois
 * a recontagem. Se a decisão estourar (o teto baixou no meio), a tx reverte e a reserva VOLTA a existir —
 * cobrada, porque a chamada foi paga. No "gerar 2" o `cap` chega já reduzido (`cap - 1`) e a reserva tem peso 2.
 */
export async function assertRecipeGenSlotInTx(
  tx: Tx,
  input: { userId: string; cap: number; consumeHoldId?: string | null },
): Promise<void> {
  const { userId, cap, consumeHoldId } = input
  if (!Number.isFinite(cap)) {
    // Papel ∞ não reserva; se o papel virou ∞ no meio do pedido, a reserva tomada antes sai mesmo assim.
    if (consumeHoldId) await deleteHoldInTx(tx, consumeHoldId)
    return
  }
  const now = new Date()
  await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.recipeGen, userId)
  if (consumeHoldId) await deleteHoldInTx(tx, consumeHoldId)
  const recentAt = [
    ...(await recentRecipeGenTimes(tx, userId, now)),
    ...(await activeHoldTimes(tx, userId, 'recipe_gen', now)),
  ]
  const decision = decideRecipeGenQuota({ cap, recentAt, now })
  if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
}

/**
 * Gate ATÔMICO da cota de geração de IMAGEM (#132/#134), DENTRO da tx corrente e SOB a advisory lock do
 * usuário: reconta os eventos do LEDGER imutável `image_generation` na janela 24h (mesma fonte de
 * `loadRecentAiGenAt`) MAIS as reservas ativas de OUTROS pedidos (ADR-0055) e decide por `decideImageQuota`.
 * Estourou ⇒ LANÇA `QuotaExceededError`. DEVE ser a PRIMEIRA operação da tx que insere a `recipe_image` + o
 * ledger. `cap` não-finito (∞) ⇒ no-op. `consumeHoldId`: mesma ordem do gate de receita (lock → DELETE da
 * própria reserva → recontagem).
 */
export async function assertImageGenSlotInTx(
  tx: Tx,
  input: { userId: string; cap: number; consumeHoldId?: string | null },
): Promise<void> {
  const { userId, cap, consumeHoldId } = input
  if (!Number.isFinite(cap)) {
    if (consumeHoldId) await deleteHoldInTx(tx, consumeHoldId)
    return
  }
  const now = new Date()
  await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.imageGen, userId)
  if (consumeHoldId) await deleteHoldInTx(tx, consumeHoldId)
  const recentAt = [
    ...(await recentImageGenTimes(tx, userId, now)),
    ...(await activeHoldTimes(tx, userId, 'image_gen', now)),
  ]
  const decision = decideImageQuota({ cap, recentAt, now })
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

/** Sugestões de cardápio do usuário na janela 24h (fonte da cota; `db` ou a tx da reserva). */
async function recentMenuSuggestionTimes(db: Database | Tx, userId: string, now: Date): Promise<Date[]> {
  const rows = await db
    .select({ createdAt: mealPlanSuggestionEvent.createdAt })
    .from(mealPlanSuggestionEvent)
    .where(
      and(
        eq(mealPlanSuggestionEvent.userId, userId),
        gte(mealPlanSuggestionEvent.createdAt, new Date(now.getTime() - RECIPE_GEN_WINDOW_MS)),
      ),
    )
  return rows.map((r) => r.createdAt)
}

/**
 * Pré-checagem BARATA (sem lock, sem escrita) da cota da Sugestão de cardápio (ADR-0036): o Usuário já
 * no teto recebe o 429 ANTES de a rota carregar ~150 candidatas. Não é o gate — a corrida é fechada
 * por `reserveMenuSuggestionSlot`, que reconta sob a lock.
 */
export async function peekMenuSuggestionQuota(
  db: Database,
  input: { userId: string; cap: number },
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const { userId, cap } = input
  if (!Number.isFinite(cap)) return { allowed: true }
  const now = new Date()
  const recentAt = await recentMenuSuggestionTimes(db, userId, now)
  return decideRecipeGenQuota({ cap, recentAt, now })
}

/**
 * RESERVA ATÔMICA de um slot da Sugestão de cardápio (ADR-0036), ANTES da chamada ao Claude — o mesmo
 * idioma da Extração (lock do usuário + recontagem do ledger + INSERT numa tx; estourou ⇒
 * `QuotaExceededError`). Diferença: devolve o id da linha, que a rota completa com modelo/tokens/custo
 * depois da chamada; e com cota ∞ (admin) a linha é gravada MESMO ASSIM (sem lock nem recontagem), pra o
 * custo da tarefa ser medido pra todo mundo. Falha da IA não devolve o slot (o custo já foi gasto).
 */
export async function reserveMenuSuggestionSlot(
  db: Database,
  input: { userId: string; cap: number },
): Promise<string> {
  const { userId, cap } = input
  return db.transaction(async (tx) => {
    if (Number.isFinite(cap)) {
      const now = new Date()
      await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.menuSuggestion, userId)
      const recentAt = await recentMenuSuggestionTimes(tx, userId, now)
      const decision = decideRecipeGenQuota({ cap, recentAt, now })
      if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
    }
    const [row] = await tx
      .insert(mealPlanSuggestionEvent)
      .values({ userId })
      .returning({ id: mealPlanSuggestionEvent.id })
    return row.id
  })
}

/**
 * Derivadas+clones VIVAS do usuário na janela 24h (fonte da cota de Derivar/Clonar, #588; `db` ou a tx
 * do gate). SEM ledger: conta as próprias linhas `recipe` — derivar é o ÚNICO caminho que grava
 * `origin='user_edited'` (setado só no INSERT, imutável depois) e `owner_id` é o leitor que forkou.
 * `owner_id = $1` usa `recipe_owner_id_idx` (parcial, só receitas com dono). Consequência ACEITA: a
 * contagem é sobre linhas VIVAS — apagar a derivada (hard delete do dono) libera o slot, então o ciclo
 * derivar→apagar não tem teto (nem o custo do embedder nele). Fechar isso exige um ledger (migração);
 * o teto mira o abuso que ACUMULA (clonar o pool em laço), que este conta (ADR-0045 emenda 2026-10-22).
 */
async function recentDerivedTimes(db: Database | Tx, userId: string, now: Date): Promise<Date[]> {
  const rows = await db
    .select({ createdAt: recipe.createdAt })
    .from(recipe)
    .where(
      and(
        eq(recipe.ownerId, userId),
        eq(recipe.origin, 'user_edited'),
        gte(recipe.createdAt, new Date(now.getTime() - RECIPE_GEN_WINDOW_MS)),
      ),
    )
  return rows.map((r) => r.createdAt)
}

/**
 * Pré-checagem BARATA (sem lock) da cota de Derivar/Clonar (#588): quem já está no teto recebe o 429
 * ANTES de a rota carregar a base inteira. Não é o gate — a corrida é fechada por `assertDeriveSlotInTx`.
 */
export async function peekDeriveQuota(
  db: Database,
  input: { userId: string; cap: number },
): Promise<{ allowed: true } | { allowed: false; retryAfterMs: number }> {
  const { userId, cap } = input
  if (!Number.isFinite(cap)) return { allowed: true }
  const now = new Date()
  const recentAt = await recentDerivedTimes(db, userId, now)
  return decideRecipeGenQuota({ cap, recentAt, now })
}

/**
 * Teto da ESPERA pela lock do derive (#588). Uma rajada de POST /derive do MESMO usuário passa toda no
 * peek (sem lock) e enfileira aqui, cada uma segurando uma conexão do pool (max 10 por instância) — sem
 * teto, centenas de pedidos de um só usuário esgotariam o pool da instância pra todo mundo. 5s cobre com
 * folga a fila legítima (cada fork segura a lock por uma transação curta).
 */
export const DERIVE_LOCK_TIMEOUT_MS = 5_000
/** `retryAfterMs` do 429 quando a espera pela lock estoura (fila cheia, não teto atingido): curto. */
export const DERIVE_LOCK_BUSY_RETRY_MS = 5_000

/** SQLSTATE `lock_not_available`: o `lock_timeout` estourou esperando uma lock. */
const LOCK_NOT_AVAILABLE = '55P03'

/**
 * Gate ATÔMICO da cota de Derivar/Clonar (#588), DENTRO da tx do fork e SOB a advisory lock do usuário:
 * reconta as `user_edited` do usuário na janela 24h (agora vendo os forks já commitados pelas
 * requisições que a lock serializou antes) e decide por `decideRecipeGenQuota` (mesma janela deslizante
 * das cotas de IA). Estourou ⇒ LANÇA `QuotaExceededError` (a tx reverte, nenhuma linha nasce). DEVE ser
 * a PRIMEIRA operação da transação de `deriveRecipe` (antes do INSERT da `recipe`). `cap` não-finito
 * (admin) ⇒ no-op, sem lock.
 *
 * Só aqui a espera pela lock tem teto (`SET LOCAL lock_timeout`, `DERIVE_LOCK_TIMEOUT_MS`): estourou ⇒ o
 * Postgres cancela o statement com 55P03 e vira o MESMO `QuotaExceededError` (429 `limite_derivar`, com
 * `DERIVE_LOCK_BUSY_RETRY_MS`), nunca 500. Logo depois da lock o `lock_timeout` volta ao default da sessão,
 * pra o resto da tx do fork não herdar o teto (um 55P03 lá adiante seria outra coisa e não deve virar 429).
 */
export async function assertDeriveSlotInTx(tx: Tx, input: { userId: string; cap: number }): Promise<void> {
  const { userId, cap } = input
  if (!Number.isFinite(cap)) return
  const now = new Date()
  await tx.execute(sql`select set_config('lock_timeout', ${`${DERIVE_LOCK_TIMEOUT_MS}ms`}, true)`)
  try {
    await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.derive, userId)
  } catch (e) {
    if (pgCode(e) === LOCK_NOT_AVAILABLE) throw new QuotaExceededError(DERIVE_LOCK_BUSY_RETRY_MS)
    throw e
  }
  await tx.execute(sql`set local lock_timeout to default`)
  const recentAt = await recentDerivedTimes(tx, userId, now)
  const decision = decideRecipeGenQuota({ cap, recentAt, now })
  if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
}

/** A espera pela lock das denúncias estourou (#605). LANÇADA de dentro da tx: o caller a captura FORA dela. */
export class ReportLockBusyError extends Error {
  constructor() {
    super('fila de denúncias da conta cheia')
    this.name = 'ReportLockBusyError'
  }
}

/**
 * Serializa as denúncias de receita do MESMO usuário (#605) dentro da tx de `createReport`: sem a lock, dois
 * envios simultâneos passariam juntos pela checagem de pendente (duas linhas na fila) e pelo teto diário. Mesma
 * espera com teto do derive (`DERIVE_LOCK_TIMEOUT_MS`, pra uma rajada não esgotar o pool): estourou ⇒ LANÇA
 * `ReportLockBusyError`, e o caller responde o 429 do teto. Lançar (e não devolver um booleano) é obrigatório: o
 * 55P03 já abortou a transação no Postgres, e seguir nela faria o COMMIT relançar o erro como 500. Depois da lock
 * o `lock_timeout` volta ao default da sessão.
 */
export async function acquireReportLockInTx(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select set_config('lock_timeout', ${`${DERIVE_LOCK_TIMEOUT_MS}ms`}, true)`)
  try {
    await acquireUserQuotaLock(tx, QUOTA_LOCK_CLASS.report, userId)
  } catch (e) {
    if (pgCode(e) === LOCK_NOT_AVAILABLE) throw new ReportLockBusyError()
    throw e
  }
  await tx.execute(sql`set local lock_timeout to default`)
}

/**
 * RESERVA de cota ANTES da chamada paga (#640/#641, ADR-0055) — geração de receita (`recipe_gen`) ou de imagem
 * (`image_gen`). Antes, o gate atômico rodava só no persist, DEPOIS do provedor: M pedidos paralelos com a cota
 * em N-1 passavam todos no pré-check (leitura) e TODOS pagavam o provedor. Agora, numa ÚNICA transação e com o
 * idioma exato do derive: `lock_timeout` de `DERIVE_LOCK_TIMEOUT_MS` → advisory lock da MESMA classe do gate do
 * persist (serializa com ele) → `lock_timeout` de volta ao default → reconta eventos + reservas ativas → decide
 * com `cap - (slots - 1)` (no "gerar 2", cabem 2 ⟺ permitido sob `cap - 1`, como o pré-check) → estourou ⇒
 * `QuotaExceededError` (a espera estourada também: 55P03 ⇒ `DERIVE_LOCK_BUSY_RETRY_MS`) → senão INSERE a reserva
 * e devolve o id.
 *
 * A reserva nasce JÁ COBRADA (`expires_at = now() + janela`, o mesmo instante em que um evento gravado agora
 * sairia da janela): função morta pelo timeout ou abort do cliente deixam o slot gasto, como deve ser. O persist
 * a CONSOME (`consumeHoldId` no gate) e a falha provadamente não paga do provedor a DEVOLVE (`releaseQuotaHold`).
 * `cap` não-finito (∞ / admin) ⇒ `null`: sem lock, sem linha.
 */
export async function reserveQuotaHold(
  db: Database,
  input: { userId: string; kind: QuotaHoldKind; cap: number; slots?: 1 | 2 },
): Promise<string | null> {
  const { userId, kind, cap } = input
  const slots = input.slots ?? 1
  if (!Number.isFinite(cap)) return null
  const { lockClass, windowMs } = HOLD_KIND[kind]
  return db.transaction(async (tx) => {
    const now = new Date()
    await tx.execute(sql`select set_config('lock_timeout', ${`${DERIVE_LOCK_TIMEOUT_MS}ms`}, true)`)
    try {
      await acquireUserQuotaLock(tx, lockClass, userId)
    } catch (e) {
      if (pgCode(e) === LOCK_NOT_AVAILABLE) throw new QuotaExceededError(DERIVE_LOCK_BUSY_RETRY_MS)
      throw e
    }
    await tx.execute(sql`set local lock_timeout to default`)
    const events =
      kind === 'recipe_gen' ? await recentRecipeGenTimes(tx, userId, now) : await recentImageGenTimes(tx, userId, now)
    const recentAt = [...events, ...(await activeHoldTimes(tx, userId, kind, now))]
    const decide = kind === 'recipe_gen' ? decideRecipeGenQuota : decideImageQuota
    const decision = decide({ cap: cap - (slots - 1), recentAt, now })
    if (!decision.allowed) throw new QuotaExceededError(decision.retryAfterMs)
    const [row] = await tx
      .insert(quotaHold)
      .values({
        userId,
        kind,
        slots,
        expiresAt: sql`now() + (${windowMs}::double precision * interval '1 millisecond')`,
      })
      .returning({ id: quotaHold.id })
    return row.id
  })
}

/**
 * DEVOLVE a reserva (ADR-0055): só quando a chamada paga provadamente NÃO foi cobrada — o provedor respondeu
 * erro HTTP ou a conexão foi recusada antes de qualquer resposta (`cause: 'provider'` no `parse_failed`,
 * `ClaudeProviderUnavailableError` no stream, `ImageProviderUnavailableError` na imagem). Idempotente (`null` ou
 * reserva já apagada ⇒ no-op). Best-effort: falha do banco aqui deixa o slot cobrado (erra a favor do custo) e
 * não derruba a resposta de erro que o pedido já ia dar.
 */
export async function releaseQuotaHold(db: Database, holdId: string | null): Promise<void> {
  if (!holdId) return
  try {
    await db.delete(quotaHold).where(eq(quotaHold.id, holdId))
  } catch (err) {
    console.error(`[quota] falha ao devolver a reserva de cota: ${errorLogFields(err)}`)
  }
}
