import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, recipeTranslation, users } from '@/db/schema'
import { decideModerationReason } from '@/domain/report'

/**
 * Fila PROATIVA do Curador (#227, ADR-0022 dec.3) — o sinal de revisão que o ADR-0020 antecipou.
 * Uma geração-por-IA COM refino (o sufixo de estilo em texto livre do Owner, #223) marca a imagem
 * resultante `review_required`; esta fila surfa essas gerações refinadas para o Curador MONITORAR.
 *
 * É PROATIVA e NÃO-BLOQUEANTE: a imagem `review_required` segue PÚBLICA/selecionável (default-open
 * INTACTO, ADR-0020) — publicar NÃO é gateado por isso. O Curador reage de duas formas, AMBAS
 * removendo o item da fila (predicado `review_required AND moderated_at IS NULL`):
 *  - REMOVER (`applyReviewImageModeration`) = moderar a imagem (#133): esconde do público
 *    (placeholder via os gates do #225/#133); o Owner segue vendo. moderated_at setado ⇒ sai da fila.
 *  - DISPENSAR (`dismissReviewImage`): o Curador julgou OK ⇒ zera `review_required`. A imagem fica
 *    pública (NÃO modera). review_required=false ⇒ sai da fila. Mantém a fila enxuta/acionável.
 *
 * O contexto receita↔imagem (#227 sutileza): uma imagem `review_required` é DESELECIONADA (geração =
 * preview, #222) ⇒ `recipe.image_id` NÃO aponta para ela. O elo é a LINHAGEM: `recipe.lineage_id =
 * recipe_image.lineage_id`. Resolvemos UMA receita representativa por imagem via LATERAL: preferimos
 * a do criador (`created_by`) e a versão mais recente — pro Curador ter título/owner/link funcional.
 * Sem receita na linhagem (raro) ⇒ a imagem ainda aparece, só com contexto mínimo (campos null).
 */
export type ReviewQueueItem = {
  imageId: string
  url: string
  createdAt: Date
  /** A receita representativa da linhagem (null se nenhuma resolver — a imagem ainda surfa). */
  recipeId: string | null
  /** Título da receita no locale original (null se não houver receita/tradução). */
  recipeTitle: string | null
  /** Nome de exibição do dono da receita (null para Catálogo/sem dono ou sem receita). */
  ownerName: string | null
  /** Handle público do dono (para o link de perfil; null quando não há dono/receita). */
  ownerHandle: string | null
}

export async function listReviewQueue(db: Database): Promise<ReviewQueueItem[]> {
  // LATERAL: por imagem, escolhe UMA receita da MESMA linhagem — preferindo a do criador da imagem
  // (created_by) e a versão mais recente — deterministicamente (ORDER BY ... LIMIT 1). LEFT JOIN ⇒
  // a imagem aparece mesmo sem receita na linhagem (contexto null). Junta o dono (LEFT) p/ nome/handle.
  const rows = await db
    .select({
      imageId: recipeImage.id,
      url: recipeImage.blobUrl,
      createdAt: recipeImage.createdAt,
      recipeId: sql<string | null>`ctx.recipe_id`,
      recipeTitle: sql<string | null>`ctx.titulo`,
      ownerName: users.name,
      ownerHandle: users.handle,
    })
    .from(recipeImage)
    .leftJoin(
      sql`lateral (
        select r.id as recipe_id, r.owner_id as owner_id, t.titulo as titulo
        from ${recipe} r
        left join ${recipeTranslation} t
          on t.recipe_id = r.id and t.locale = r.original_locale
        where r.lineage_id = ${recipeImage.lineageId}
        order by (r.owner_id is not distinct from ${recipeImage.createdBy}) desc, r.created_at desc
        limit 1
      ) ctx`,
      sql`true`,
    )
    .leftJoin(users, sql`${users.id} = ctx.owner_id`)
    .where(and(eq(recipeImage.reviewRequired, true), isNull(recipeImage.moderatedAt)))
    .orderBy(recipeImage.createdAt, recipeImage.id)

  return rows.map((r) => ({
    imageId: r.imageId,
    url: r.url,
    createdAt: r.createdAt,
    recipeId: r.recipeId ?? null,
    recipeTitle: r.recipeTitle ?? null,
    ownerName: r.ownerName ?? null,
    ownerHandle: r.ownerHandle ?? null,
  }))
}

/**
 * MODERAR a imagem DIRETO por `imageId` (#227) — o Curador remove uma imagem da fila proativa.
 * Espelha `applyImageModeration` (#133) mas SEM Report: keyed pelo imageId, FOR UPDATE na própria
 * `recipe_image`, motivo obrigatório (`decideModerationReason`), preserva a 1ª proveniência
 * (re-moderar NÃO sobrescreve ⇒ `ok_already_moderated`). Reusa as COLUNAS de moderação (#133) + os
 * gates do #225 (uma imagem moderada some do público = placeholder; não vira face pública). Moderar
 * seta `moderated_at` ⇒ a imagem cai da fila (`moderated_at IS NULL` deixa de valer).
 */
export type ReviewImageModerationResult =
  | { kind: 'ok' } //                   200 — moderou agora
  | { kind: 'ok_already_moderated' } // 200 — já estava moderada (preserva a 1ª proveniência)
  | { kind: 'not_found' } //            404 — imagem inexistente
  | { kind: 'invalid_reason' } //       400 — motivo vazio

export async function applyReviewImageModeration(input: {
  db: Database
  imageId: string // já validado uuid pelo route
  curatorId: string // session.user.id (route já passou pelo requireRole 'curador')
  reason: string
}): Promise<ReviewImageModerationResult> {
  const { db, imageId, curatorId, reason } = input

  return db.transaction(async (tx) => {
    // Estado atual da imagem (FOR UPDATE serializa moderações concorrentes; tabela única, sem join).
    const [img] = await tx
      .select({ moderatedAt: recipeImage.moderatedAt })
      .from(recipeImage)
      .where(eq(recipeImage.id, imageId))
      .for('update')
    if (!img) return { kind: 'not_found' as const }

    // Motivo obrigatório (espelha #133/#18), após existência, antes de qualquer write.
    if (!decideModerationReason({ reason }).allowed) return { kind: 'invalid_reason' as const }

    const alreadyModerated = img.moderatedAt != null
    if (!alreadyModerated) {
      // NUNCA apaga o blob nem zera image_id (ADR-0016): só esconde do público. Owner segue vendo.
      await tx
        .update(recipeImage)
        .set({ moderatedAt: sql`now()`, moderatedReason: reason, moderatedBy: curatorId })
        .where(eq(recipeImage.id, imageId))
    }

    return alreadyModerated ? { kind: 'ok_already_moderated' as const } : { kind: 'ok' as const }
  })
}

/**
 * DISPENSAR uma imagem da fila proativa (#227) — o Curador julgou a geração refinada OK: zera
 * `review_required` ⇒ a imagem cai da fila SEM moderar (segue pública, ADR-0020). Idempotente
 * (zerar de novo é no-op). Mantém a fila acionável/limitada: sem isto, imagens OK ficariam ali p/ sempre.
 */
export type DismissReviewImageResult = { kind: 'ok' } | { kind: 'not_found' }

export async function dismissReviewImage(input: {
  db: Database
  imageId: string // já validado uuid pelo route
}): Promise<DismissReviewImageResult> {
  const { db, imageId } = input

  const updated = await db
    .update(recipeImage)
    .set({ reviewRequired: false })
    .where(eq(recipeImage.id, imageId))
    .returning({ id: recipeImage.id })

  return updated.length > 0 ? { kind: 'ok' } : { kind: 'not_found' }
}
