import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeReview, users } from '@/db/schema'
import { RETENTION_DAYS } from '@/domain/account-purge'
import type { ImageStore } from '@/server/images/image-store'
import { deleteOrphanBlob } from '@/server/recipe/image'
import { recordDsarEvent } from '@/server/legal/dsar-audit'

/**
 * Varredura de EXPURGO FÍSICO pós-retenção das contas anonimizadas (issue #411, LGPD Art. 16;
 * `docs/legal/takedown-e-remocao-titular.md` §6/§8). A eliminação self-service (#401, `eraseOwnAccount`)
 * ANONIMIZA a PII do titular e carimba `anonymized_at`, mas MANTÉM o conteúdo (recipe.owner_id é ON DELETE
 * RESTRICT + decisão de produto/jurídica de manter conteúdo anonimizado). Sobra, porém, PII RESIDUAL em
 * storage: as fotos das AVALIAÇÕES do titular (`recipe_review.photo_url` — foto do prato cozinhado, sobe
 * do dispositivo do usuário). Passado o prazo de retenção, este job remove esses BLOBS e nula os
 * ponteiros, SEM hard-delete da linha `users` nem das avaliações (as linhas ficam anonimizadas).
 *
 * `now` é INJETADO (o kernel `@/domain/account-purge` é puro/testável com datas simuladas; o cron passa
 * `new Date()`). IDEMPOTENTE: uma 2ª passada não acha mais `photo_url` a nular (já nulos) → nada a
 * expurgar, nenhum evento novo. Cada expurgo é auditado (DSAR append-only) por titular efetivamente
 * expurgado. O padrão de reap (coleta na tx, `deleteOrphanBlob` só APÓS o commit; `store.owns` protege URL
 * estrangeira) espelha `clearSourceAttribution`/`deleteOwnRecipe`.
 *
 * O prazo de retenção vem de `RETENTION_DAYS` (180, conservador — [a confirmar no sign-off #276]),
 * sobrescritível por `ACCOUNT_PURGE_RETENTION_DAYS` lido AQUI no server (não no kernel puro), fail-safe ao
 * default quando ausente/inválido.
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
function resolveRetentionDays(): number {
  const raw = process.env.ACCOUNT_PURGE_RETENTION_DAYS
  if (raw === undefined) return RETENTION_DAYS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : RETENTION_DAYS
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
    // blobs saem só APÓS o commit (best-effort — sem rollback de blob). Tx por titular: uma falha
    // isolada não derruba o expurgo dos demais.
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
