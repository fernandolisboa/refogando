import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import { generateImageDerivatives } from '@/server/images/image-derivatives'
import { deleteOrphanBlobs } from '@/server/images/image-blobs'

/**
 * BACKFILL dos derivados WebP das imagens anteriores à 0077 (achado I da auditoria de performance;
 * handoff 69). Roda em lotes pequenos pelo cron `/api/cron/image-derivatives` (diário, `vercel.json`),
 * com as credenciais do próprio deploy: ninguém precisa do token do Blob nem da URL do banco de produção
 * na máquina local. Cada passada lê o ORIGINAL do Blob, gera os dois derivados e preenche as colunas.
 *
 * PROPRIEDADES (inegociáveis):
 *  - NÃO DESTRUTIVO: nunca apaga nem sobrescreve o original (`blob_url` é só lido) nem um derivado já
 *    gravado. O UPDATE só preenche linha com `thumb_url`/`detail_url` AINDA NULL e com o MESMO `blob_url`
 *    lido; se não casar (a linha sumiu, foi preenchida por outra passada, ou o original mudou), os
 *    derivados recém-subidos desta passada são apagados (são NOSSOS e ninguém os referencia).
 *  - IDEMPOTENTE e seguro de repetir: imagem preenchida sai da fila. Duas passadas concorrentes no pior
 *    caso geram o mesmo par duas vezes e a perdedora apaga o seu.
 *  - FILA (`queueWhere`): sem derivados (`thumb_url IS NULL`), NÃO moderada (`moderated_at IS NULL`: não
 *    aparece no público e o dono vê no estúdio, onde o original basta) e nunca tentada ou tentada há mais
 *    de `DERIVATIVES_RETRY_AFTER_DAYS`. Cada tentativa carimba `derivatives_attempted_at`, então uma falha
 *    PERMANENTE (imagem animada, formato que não ganha derivado, original sumido, host estrangeiro) sai da
 *    fila por uma semana em vez de ser baixada de novo todo dia, e a fila chega a zero.
 *  - ORDEM: nunca tentadas primeiro; dentro do mesmo carimbo, as imagens SELECIONADAS (a face exibida,
 *    `recipe.image_id`, de qualquer versão) antes das que só estão na Galeria, e as mais antigas primeiro.
 *  - EM LOTES: no máximo `limit` imagens por passada, e não começa imagem nova quando sobram menos de
 *    `reserveMs` do orçamento (`budgetMs`): uma imagem no pior caso leva ~10 s de download + 2 × 10 s de
 *    sharp (os timeouts), e a função da Vercel tem `maxDuration`.
 *  - Só lê original NOSSO (`store.owns`): `recipe_image.blob_url` sempre é do nosso Blob; uma URL de outro
 *    host não é buscada (conta como falha e sai da fila por uma semana).
 */

/** Imagens por passada. Cada uma custa ~1 s (baixar ~1,5 MB, reduzir, subir 2 WebP). */
export const DERIVATIVES_BACKFILL_LIMIT = 25

/** Orçamento de tempo da passada: abaixo do `maxDuration = 60` da rota do cron, com folga. */
export const DERIVATIVES_BACKFILL_BUDGET_MS = 40_000

/**
 * Não começa imagem nova com menos que isto do orçamento: com o padrão, a última começa até os 25 s e,
 * mesmo no pior caso de uma imagem (~30 s com os timeouts), termina antes do `maxDuration` de 60 s.
 */
export const DERIVATIVES_BACKFILL_RESERVE_MS = 15_000

/** Uma imagem que falhou volta à fila depois disto (falha permanente custa um download por semana). */
export const DERIVATIVES_RETRY_AFTER_DAYS = 7

const DAY_MS = 86_400_000

export type DerivativesBackfillResult = {
  /** Imagens NA FILA antes da passada (sem derivados, não moderadas, nunca tentadas ou há > 7 dias). */
  pendentes: number
  /** Das `pendentes`, as que o backfill nunca tentou (anteriores à 0077 ainda não vistas). */
  nuncaTentadas: number
  /** Imagens que a passada tentou. */
  tentadas: number
  /** Imagens que ganharam os derivados nesta passada. */
  preenchidas: number
  /** Tentativas que falharam (original ilegível ou fora do nosso Blob, sharp, storage). Ficam NULL. */
  falhas: number
  /** Derivados gerados mas descartados (a linha mudou no meio; os blobs novos foram apagados). */
  descartadas: number
  /**
   * Imagens na fila DEPOIS da passada (recontadas). Toda tentativa sai da fila (preenchida, ou
   * carimbada por uma semana), então `restantes = 0` quer dizer: nada mais a fazer até alguma falha
   * voltar da espera de 7 dias ou alguma escrita nova falhar nos derivados.
   */
  restantes: number
  /** Nunca tentadas DEPOIS da passada. `0` ⇒ o backfill já passou por todas as imagens antigas. */
  nuncaTentadasRestantes: number
}

/** Filtro da fila (ver PROPRIEDADES). `retryBefore`: carimbo mais antigo que isto volta à fila. */
function queueWhere(retryBefore: Date) {
  return and(
    isNull(recipeImage.thumbUrl),
    isNull(recipeImage.moderatedAt),
    or(isNull(recipeImage.derivativesAttemptedAt), lt(recipeImage.derivativesAttemptedAt, retryBefore)),
  )
}

/** Tamanho da fila e quantas dela nunca foram tentadas (um `count` só). */
async function countQueue(db: Database, retryBefore: Date): Promise<{ total: number; nuncaTentadas: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      nuncaTentadas: sql<number>`(count(*) FILTER (WHERE ${recipeImage.derivativesAttemptedAt} IS NULL))::int`,
    })
    .from(recipeImage)
    .where(queueWhere(retryBefore))
  return row
}

/**
 * Uma passada do backfill. `now` é injetado (testes); `clock` mede o orçamento (default `Date.now`).
 */
export async function backfillImageDerivatives(
  db: Database,
  store: ImageStore,
  opts: { limit?: number; budgetMs?: number; reserveMs?: number; now?: Date; clock?: () => number } = {},
): Promise<DerivativesBackfillResult> {
  const limit = opts.limit ?? DERIVATIVES_BACKFILL_LIMIT
  const budgetMs = opts.budgetMs ?? DERIVATIVES_BACKFILL_BUDGET_MS
  const reserveMs = opts.reserveMs ?? DERIVATIVES_BACKFILL_RESERVE_MS
  const clock = opts.clock ?? Date.now
  const startedAt = clock()
  const now = opts.now ?? new Date()
  const retryBefore = new Date(now.getTime() - DERIVATIVES_RETRY_AFTER_DAYS * DAY_MS)

  const before = await countQueue(db, retryBefore)
  const result: DerivativesBackfillResult = {
    pendentes: before.total,
    nuncaTentadas: before.nuncaTentadas,
    tentadas: 0,
    preenchidas: 0,
    falhas: 0,
    descartadas: 0,
    restantes: before.total,
    nuncaTentadasRestantes: before.nuncaTentadas,
  }
  if (before.total === 0 || limit <= 0) return result

  // `thumb_url IS NULL` basta (o CHECK da 0077 amarra o par). Selecionadas primeiro dentro do carimbo.
  const isSelected = sql`EXISTS (SELECT 1 FROM ${recipe} WHERE ${recipe.imageId} = ${recipeImage.id})`
  const queue = await db
    .select({ id: recipeImage.id, blobUrl: recipeImage.blobUrl })
    .from(recipeImage)
    .where(queueWhere(retryBefore))
    .orderBy(
      sql`${recipeImage.derivativesAttemptedAt} ASC NULLS FIRST`,
      sql`${isSelected} DESC`,
      asc(recipeImage.createdAt),
      asc(recipeImage.id),
    )
    .limit(limit)

  for (const img of queue) {
    if (clock() - startedAt > budgetMs - reserveMs) break
    result.tentadas++
    const outcome = await backfillOne(db, store, img, now)
    result[outcome]++
  }

  if (result.tentadas > 0) {
    const after = await countQueue(db, retryBefore)
    result.restantes = after.total
    result.nuncaTentadasRestantes = after.nuncaTentadas
  }
  return result
}

async function backfillOne(
  db: Database,
  store: ImageStore,
  img: { id: string; blobUrl: string },
  now: Date,
): Promise<'preenchidas' | 'falhas' | 'descartadas'> {
  // Carimba a tentativa ANTES do trabalho: se a função morrer no meio (timeout), a imagem já saiu da
  // fila e a próxima passada começa por outra.
  await db
    .update(recipeImage)
    .set({ derivativesAttemptedAt: now })
    .where(and(eq(recipeImage.id, img.id), isNull(recipeImage.thumbUrl)))

  if (!store.owns(img.blobUrl)) return 'falhas'
  let original: { data: Buffer } | null
  try {
    original = await store.get(img.blobUrl)
  } catch (err) {
    console.warn(`[image-derivatives] original ilegível: ${err instanceof Error ? err.name : 'erro'}`)
    return 'falhas'
  }
  if (!original) return 'falhas'

  // Nunca lança: falha ⇒ log `[imagens]` + null (o par segue NULL).
  const derivatives = await generateImageDerivatives(store, original.data)
  if (!derivatives) return 'falhas'

  const filled = await db
    .update(recipeImage)
    .set({ thumbUrl: derivatives.thumbUrl, detailUrl: derivatives.detailUrl })
    .where(
      and(
        eq(recipeImage.id, img.id),
        eq(recipeImage.blobUrl, img.blobUrl),
        isNull(recipeImage.thumbUrl),
        isNull(recipeImage.detailUrl),
      ),
    )
    .returning({ id: recipeImage.id })
  if (filled.length > 0) return 'preenchidas'

  // A linha mudou no meio: o par recém-subido não entrou em linha nenhuma (só os NOSSOS, best-effort).
  await deleteOrphanBlobs(store, [derivatives.thumbUrl, derivatives.detailUrl])
  return 'descartadas'
}
