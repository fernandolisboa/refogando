import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import { generateImageDerivatives, type ImageDerivativeUrls } from '@/server/images/image-derivatives'

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
 *  - IDEMPOTENTE e seguro de repetir: a fila é `thumb_url IS NULL`; imagem preenchida sai dela. Duas
 *    passadas concorrentes no pior caso geram o mesmo par duas vezes e a perdedora apaga o seu.
 *  - EM LOTES: no máximo `limit` imagens por passada e para de começar imagem nova quando o orçamento de
 *    tempo (`budgetMs`) acaba (a função da Vercel tem `maxDuration`).
 *  - SEM FOME: cada tentativa carimba `derivatives_attempted_at`; a fila ordena por esse carimbo (NULL
 *    primeiro), então uma imagem que falha sempre (original sumido, bytes corrompidos) vai para o fim e
 *    não trava as outras. Dentro do mesmo carimbo, as faces públicas (`recipe.image_id`) vêm antes das
 *    imagens só de galeria, e as mais antigas primeiro.
 *  - Só lê original NOSSO (`store.owns`): `recipe_image.blob_url` sempre é do nosso Blob; uma URL de outro
 *    host não é buscada (conta como falha e vai para o fim da fila).
 */

/** Imagens por passada. Cada uma custa ~1 s (baixar ~1,5 MB, reduzir, subir 2 WebP). */
export const DERIVATIVES_BACKFILL_LIMIT = 25

/** Orçamento de tempo da passada: abaixo do `maxDuration = 60` da rota do cron, com folga. */
export const DERIVATIVES_BACKFILL_BUDGET_MS = 40_000

export type DerivativesBackfillResult = {
  /** Imagens sem derivados ANTES da passada (a fila inteira). */
  pendentes: number
  /** Imagens que a passada tentou. */
  tentadas: number
  /** Imagens que ganharam os derivados nesta passada. */
  preenchidas: number
  /** Tentativas que falharam (original ilegível ou fora do nosso Blob, sharp, storage). Ficam NULL. */
  falhas: number
  /** Derivados gerados mas descartados (a linha mudou no meio; os blobs novos foram apagados). */
  descartadas: number
}

/**
 * Uma passada do backfill. `now` é injetado (testes); `clock` mede o orçamento (default `Date.now`).
 */
export async function backfillImageDerivatives(
  db: Database,
  store: ImageStore,
  opts: { limit?: number; budgetMs?: number; now?: Date; clock?: () => number } = {},
): Promise<DerivativesBackfillResult> {
  const limit = opts.limit ?? DERIVATIVES_BACKFILL_LIMIT
  const budgetMs = opts.budgetMs ?? DERIVATIVES_BACKFILL_BUDGET_MS
  const clock = opts.clock ?? Date.now
  const startedAt = clock()

  const [{ pendentes }] = await db
    .select({ pendentes: sql<number>`count(*)::int` })
    .from(recipeImage)
    .where(isNull(recipeImage.thumbUrl))

  const result: DerivativesBackfillResult = { pendentes, tentadas: 0, preenchidas: 0, falhas: 0, descartadas: 0 }
  if (pendentes === 0 || limit <= 0) return result

  // `thumb_url IS NULL` basta (o CHECK da 0077 amarra o par). Faces primeiro dentro do mesmo carimbo.
  const isFace = sql`EXISTS (SELECT 1 FROM ${recipe} WHERE ${recipe.imageId} = ${recipeImage.id})`
  const queue = await db
    .select({ id: recipeImage.id, blobUrl: recipeImage.blobUrl })
    .from(recipeImage)
    .where(isNull(recipeImage.thumbUrl))
    .orderBy(
      sql`${recipeImage.derivativesAttemptedAt} ASC NULLS FIRST`,
      sql`${isFace} DESC`,
      asc(recipeImage.createdAt),
      asc(recipeImage.id),
    )
    .limit(limit)

  for (const img of queue) {
    if (clock() - startedAt >= budgetMs) break
    result.tentadas++
    const outcome = await backfillOne(db, store, img, opts.now ?? new Date())
    result[outcome]++
  }
  return result
}

async function backfillOne(
  db: Database,
  store: ImageStore,
  img: { id: string; blobUrl: string },
  now: Date,
): Promise<'preenchidas' | 'falhas' | 'descartadas'> {
  // Carimba a tentativa ANTES do trabalho: se a função morrer no meio (timeout), a imagem já foi para o
  // fim da fila e a próxima passada começa por outra.
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

  await discardDerivatives(store, derivatives)
  return 'descartadas'
}

/** Apaga os derivados recém-subidos que não entraram em linha nenhuma (só os NOSSOS, best-effort). */
async function discardDerivatives(store: ImageStore, d: ImageDerivativeUrls): Promise<void> {
  for (const url of [d.thumbUrl, d.detailUrl]) {
    if (!store.owns(url)) continue
    try {
      await store.delete(url)
    } catch {
      // órfão tolerável.
    }
  }
}
