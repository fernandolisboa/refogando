import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeReview, users } from '@/db/schema'
import { RETENTION_DAYS } from '@/domain/account-purge'
import { errorLogFields } from '@/domain/error-report'
import type { ImageStore } from '@/server/images/image-store'
import { deleteOrphanBlob, deleteOrphanBlobsConcurrently } from '@/server/images/image-blobs'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import {
  privateLeftovers,
  purgePrivateContentInTx,
  type PrivateContentCounts,
} from '@/server/legal/private-content'
import { timeBudget, type TimeBudget } from '@/server/time-budget'

/**
 * As duas varreduras das contas anonimizadas (`docs/legal/takedown-e-remocao-titular.md` §6/§8; ADR-0049).
 * A eliminação self-service (#401/#473, `eraseOwnAccount`) anonimiza a PII, carimba `anonymized_at` e, desde
 * o #473, já APAGA o conteúdo privado na mesma transação; o conteúdo PÚBLICO (Receitas públicas, avaliações)
 * fica, com o autor anonimizado (`recipe.owner_id` é ON DELETE RESTRICT e a linha `users` não é apagada).
 *
 *  - `purgeAnonymizedPrivateContent` (#473): SEM espera. Acha toda conta anonimizada em que ainda sobra
 *    conteúdo privado (`privateLeftovers`) e roda o mesmo núcleo da eliminação (`purgePrivateContentInTx`).
 *    Cobre as contas eliminadas antes do #473 (na 1ª passada depois do deploy) e as sobras de corrida (uma
 *    geração em voo que grava uma Receita privada depois do commit da eliminação). Uma conta por transação,
 *    em try/catch: a falha de uma conta é contada e logada (sem id) e a passada segue com as outras. Em
 *    lotes (`PRIVATE_PURGE_BATCH`), numa ordem que muda todo dia, e com o orçamento de tempo da rota.
 *  - `purgeAnonymizedAccounts` (#411, LGPD Art. 16): passado o prazo de retenção, remove a PII RESIDUAL em
 *    storage — as fotos das AVALIAÇÕES do titular (`recipe_review.photo_url`, foto do prato que subiu do
 *    dispositivo) — e nula os ponteiros, SEM apagar a linha `users` nem as avaliações.
 *
 * `now` é INJETADO (o kernel `@/domain/account-purge` é puro/testável com datas simuladas; o cron passa
 * `new Date()`). IDEMPOTENTES: numa 2ª passada não sobra conteúdo privado nem `photo_url` a nular → nada a
 * expurgar, nenhum evento novo. Cada expurgo é auditado (DSAR append-only) por titular efetivamente
 * expurgado. O padrão de reap (coleta na tx, deleção do blob só APÓS o commit; `store.owns` protege URL
 * estrangeira) espelha `clearSourceAttribution`/`deleteOwnRecipe`.
 *
 * O prazo das fotos vem de `RETENTION_DAYS` (180), sobrescritível por `ACCOUNT_PURGE_RETENTION_DAYS` lido
 * AQUI no server (não no kernel puro), fail-safe ao default quando ausente/inválido.
 */

export type PurgeScanResult = {
  /** Contas anonimizadas passadas da retenção examinadas nesta passada. */
  scanned: number
  /** Blobs de PII residual efetivamente apagados (só os NOSSOS — `store.owns`). */
  blobsReaped: number
  /** Ponteiros `photo_url` de avaliações nulados nesta passada. */
  reviewsCleared: number
}

const MS_PER_DAY = 86_400_000

/** Prazo de retenção resolvido: env `ACCOUNT_PURGE_RETENTION_DAYS` (server) ou o default do kernel. */
export function resolveRetentionDays(): number {
  const raw = process.env.ACCOUNT_PURGE_RETENTION_DAYS
  if (raw === undefined || raw.trim() === '') return RETENTION_DAYS
  const n = Number(raw)
  // Fail-safe: este é um job DESTRUTIVO — um retention de 0 dia acidental expurgaria TODAS as
  // contas anonimizadas de uma vez. Só aceitamos um inteiro ESTRITAMENTE POSITIVO; vazio, espaço,
  // 0, negativo, NaN ou fracionário caem no default conservador (RETENTION_DAYS).
  return Number.isInteger(n) && n > 0 ? n : RETENTION_DAYS
}

export async function purgeAnonymizedAccounts(
  db: Database,
  store: ImageStore,
  now: Date,
): Promise<PurgeScanResult> {
  const cutoff = new Date(now.getTime() - resolveRetentionDays() * MS_PER_DAY)

  // Candidatos: anonimizados (anonymized_at != null) cujo carimbo é MAIS VELHO que o prazo de retenção.
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.anonymizedAt), lt(users.anonymizedAt, cutoff)))

  let blobsReaped = 0
  let reviewsCleared = 0

  for (const u of candidates) {
    // Por titular, numa tx: acha as avaliações com foto, nula os ponteiros e AUDITA (atomicidade). Os
    // blobs saem só APÓS o commit (best-effort — sem rollback de blob). Tx por titular: o que já foi
    // expurgado fica; uma falha interrompe a passada (o cron loga e responde 500) e a próxima retoma.
    const urls = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: recipeReview.id, photoUrl: recipeReview.photoUrl })
        .from(recipeReview)
        .where(and(eq(recipeReview.userId, u.id), isNotNull(recipeReview.photoUrl)))
      if (rows.length === 0) return [] as string[] // nada a expurgar → sem UPDATE, sem evento (idempotência)

      const ids = rows.map((r) => r.id)
      await tx
        .update(recipeReview)
        .set({ photoUrl: null, updatedAt: now })
        .where(inArray(recipeReview.id, ids))

      // Auditoria DSAR (append-only): o expurgo ATENDE (fulfills) a eliminação #401 já pós-retenção. O
      // payload hasheia os ids das avaliações cujo blob de PII saiu (prova, nunca em claro); `details`
      // leva só contagens não-sensíveis. Ver openConcerns: reusamos o vocabulário DSAR_FULFILLED (o mais
      // próximo) — seu payload nasceu p/ remoção de atribuição de receita, aqui serve de prova-de-expurgo.
      await recordDsarEvent(tx, {
        eventType: 'DSAR_FULFILLED',
        channel: 'system', // job do sistema (cron), sem ator humano
        requestType: 'account_purge',
        actorId: null,
        fulfillment: {
          recipeIds: ids, // ids das avaliações expurgadas (campo genérico de "entidades afetadas")
          removedSourceName: `account_purge:${u.id}`,
          ts: now.toISOString(),
        },
        details: { reviewsCleared: ids.length },
      })

      // Ponteiros non-null garantidos pelo WHERE isNotNull — coleta as URLs p/ reap pós-commit.
      return rows.map((r) => r.photoUrl).filter((url): url is string => url !== null)
    })

    reviewsCleared += urls.length
    // Reap dos blobs DEPOIS do commit. `store.owns` protege URL estrangeira (no-op silencioso); só
    // contamos como reaped o que é NOSSO e efetivamente apagável.
    for (const url of urls) {
      if (store.owns(url)) blobsReaped += 1
      await deleteOrphanBlob(store, url)
    }
  }

  return { scanned: candidates.length, blobsReaped, reviewsCleared }
}

/** Contas por passada da varredura do conteúdo privado. */
export const PRIVATE_PURGE_BATCH = 25

/**
 * Orçamento de tempo da passada do cron `account-purge`, contado do começo da ROTA (as varreduras anteriores
 * gastam dele): abaixo do `maxDuration = 60` da rota, com folga.
 */
export const ACCOUNT_PURGE_BUDGET_MS = 40_000

/**
 * A varredura do conteúdo privado não começa conta nova com menos que isto do orçamento: a última começa até
 * os 25 s e, com centenas de Receitas e os blobs depois do commit, termina antes do `maxDuration` de 60 s. A
 * passada seguinte retoma (`privateAccountsDeferred` conta as que ficaram).
 */
export const ACCOUNT_PURGE_RESERVE_MS = 15_000

/** O orçamento padrão da passada (a rota cria o seu no começo e passa o mesmo a cada varredura). */
export function accountPurgeBudget(): TimeBudget {
  return timeBudget({ budgetMs: ACCOUNT_PURGE_BUDGET_MS, reserveMs: ACCOUNT_PURGE_RESERVE_MS })
}

/** Contagens da varredura do conteúdo privado. A ORDEM das chaves é a da linha `[account-purge]`. */
export type PrivatePurgeResult = {
  /** Contas em que algo saiu nesta passada. */
  privateAccountsSwept: number
  /** Contas cuja transação falhou (nada delas mudou; voltam na próxima passada). */
  privateAccountsFailed: number
  /** Candidatas do lote que o orçamento de tempo não deixou começar (voltam na próxima passada). */
  privateAccountsDeferred: number
  /** Receitas privadas apagadas. */
  privateRecipesDeleted: number
  /** Linhas `recipe_image` apagadas (faces sem referência e galeria). */
  privateImagesDeleted: number
  /** Blobs NOSSOS apagados depois do commit (imagens e fotos de avaliação). */
  privateBlobsReaped: number
  /**
   * As demais linhas APAGADAS (Transcrição, itens do Briefing, coleções, salvos, listas, follows, notificações,
   * Plano, Despensa).
   */
  privateRowsDeleted: number
  /** Linhas LIMPAS, que ficam sem o texto (sessões de criação, gerações, Briefings). */
  privateRowsScrubbed: number
}

/**
 * Em que chave da linha cada contagem do núcleo entra. As fotos das avaliações são blobs (já contados em
 * `privateBlobsReaped`), não linhas. Contagem nova no núcleo sem destino aqui não compila.
 */
const SUMMARY_KEY = {
  recipes: 'privateRecipesDeleted',
  images: 'privateImagesDeleted',
  reviewPhotos: null,
  transcriptMessages: 'privateRowsDeleted',
  sessionsScrubbed: 'privateRowsScrubbed',
  generationsScrubbed: 'privateRowsScrubbed',
  briefingsScrubbed: 'privateRowsScrubbed',
  briefingItems: 'privateRowsDeleted',
  collections: 'privateRowsDeleted',
  saves: 'privateRowsDeleted',
  shoppingLists: 'privateRowsDeleted',
  follows: 'privateRowsDeleted',
  notifications: 'privateRowsDeleted',
  mealPlanEntries: 'privateRowsDeleted',
  pantryItems: 'privateRowsDeleted',
} as const satisfies Record<keyof PrivateContentCounts, keyof PrivatePurgeResult | null>

/**
 * Varre as contas anonimizadas que ainda têm conteúdo privado (doc do módulo). `budget` é o orçamento da
 * passada (o da rota; default, um novo, `accountPurgeBudget()`); `now` carimba as linhas e o evento.
 */
export async function purgeAnonymizedPrivateContent(
  db: Database,
  store: ImageStore,
  now: Date,
  opts: { batch?: number; budget?: TimeBudget } = {},
): Promise<PrivatePurgeResult> {
  const budget = opts.budget ?? accountPurgeBudget()
  const result: PrivatePurgeResult = {
    privateAccountsSwept: 0,
    privateAccountsFailed: 0,
    privateAccountsDeferred: 0,
    privateRecipesDeleted: 0,
    privateImagesDeleted: 0,
    privateBlobsReaped: 0,
    privateRowsDeleted: 0,
    privateRowsScrubbed: 0,
  }

  // Sem espera de retenção: o conteúdo privado de conta eliminada não tem por que ficar. A ordem muda todo
  // dia (hash do id com a data): uma conta que falha sempre não segura o lote, e a linha de falha no log é o
  // sinal.
  const candidates = await db
    .select({ id: users.id })
    .from(users)
    .where(and(isNotNull(users.anonymizedAt), privateLeftovers(users.id)))
    .orderBy(sql`md5(${users.id}::text || current_date::text)`)
    .limit(opts.batch ?? PRIVATE_PURGE_BATCH)

  for (const [i, candidate] of candidates.entries()) {
    // Antes de cada conta, inclusive a 1ª: as varreduras anteriores da rota podem ter gasto o orçamento.
    if (!budget.canStartMore()) {
      result.privateAccountsDeferred = candidates.length - i
      break
    }
    try {
      const purge = await db.transaction(async (tx) => {
        // Trava a linha e re-confere: só conta anonimizada (a seleção acima foi fora da tx).
        const [u] = await tx
          .select({ anonymizedAt: users.anonymizedAt })
          .from(users)
          .where(eq(users.id, candidate.id))
          .for('update')
        if (!u || u.anonymizedAt == null) return null
        const p = await purgePrivateContentInTx(tx, candidate.id, now)
        if (p.changed) {
          // Prova do expurgo (append-only): os ids das Receitas só no hash; `details` leva só contagens.
          await recordDsarEvent(tx, {
            eventType: 'DSAR_FULFILLED',
            channel: 'system', // job do sistema (cron), sem ator humano
            requestType: 'account_private_purge',
            actorId: null,
            fulfillment: {
              recipeIds: p.recipeIds,
              removedSourceName: `account_private_purge:${candidate.id}`,
              ts: now.toISOString(),
            },
            details: p.counts,
          })
        }
        return p
      })
      if (!purge?.changed) continue
      result.privateAccountsSwept += 1
      for (const [key, n] of Object.entries(purge.counts) as [keyof PrivateContentCounts, number][]) {
        const into = SUMMARY_KEY[key]
        if (into) result[into] += n
      }
      // Depois do commit; nunca lança (um blob que fica é órfão sem ponteiro).
      result.privateBlobsReaped += await deleteOrphanBlobsConcurrently(store, purge.blobUrls)
    } catch (err) {
      result.privateAccountsFailed += 1
      // Sem o id da conta (ADR-0048): a linha só diz que houve falha e de que tipo.
      console.error(`[account-purge] conteúdo privado de uma conta anonimizada falhou: ${errorLogFields(err)}`)
    }
  }
  return result
}
