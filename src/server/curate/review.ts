import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, recipeTranslation, users } from '@/db/schema'
import { decideModerationReason } from '@/domain/report'
import { errorLogFields } from '@/domain/error-report'
import { emitNotification } from '@/server/notification'
import { communityVisibleSqlFragment, poolBarriersSqlFragment } from '@/server/recipe/visibility-sql'

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
 * O contexto receita↔imagem: uma imagem `review_required` nasce DESELECIONADA (geração = preview, #222). Até o
 * #599 o elo era a LINHAGEM (a fila mostrava a imagem já ao gerar, mesmo sem ninguém a escolher); desde então é
 * a seleção, `recipe.image_id`: a imagem só entra quando o dono a escolhe como face de uma receita do pool.
 *
 * #599 (minimização, LGPD art. 6º, III): a fila só mostra a imagem que o PÚBLICO vê, isto é, a selecionada
 * (`recipe.image_id`) numa receita do pool (`POOL_RECIPE_SQL`, o mesmo predicado de `eligibleForPool`). O resto da
 * Galeria é privado do dono (CONTEXT.md), mesmo de uma receita publicada: as prévias nunca escolhidas e as
 * imagens de uma versão privada nunca chegam à curadoria. O predicado é avaliado a cada leitura, então a imagem
 * entra na fila quando passa a ser a face de uma receita publicada (publicar, ou trocar a foto de uma já pública)
 * e sai se deixar de ser. A receita representativa é sempre a que mostra a imagem, para o Curador nunca ver o
 * título de uma versão privada. A exibição pública não muda: a imagem `review_required` segue pública/selecionável
 * até moderada (default-open, ADR-0020). Remover e dispensar seguem pelo id (uma aba aberta antes de a imagem
 * sair da fila ainda age sobre ela; o Curador já a tinha visto).
 */
export type ReviewQueueItem = {
  imageId: string
  url: string
  createdAt: Date
  /** A receita do pool que mostra a imagem (#599: nunca null; sem ela a imagem não entra na fila). */
  recipeId: string | null
  /** Título da receita no locale original (null se faltar a tradução). */
  recipeTitle: string | null
  /** Nome de exibição do dono da receita (null para Catálogo/sem dono ou sem receita). */
  ownerName: string | null
  /** Handle público do dono (para o link de perfil; null quando não há dono/receita). */
  ownerHandle: string | null
}

/**
 * A receita `r` está no pool (#599): visível à comunidade e sem as barreiras do pool (playful, removida,
 * importada da web) — os fragmentos de `visibility-sql.ts`, o mesmo predicado de `eligibleForPool`.
 */
const POOL_RECIPE_SQL = sql`${communityVisibleSqlFragment('r')} and ${poolBarriersSqlFragment('r')}`

export async function listReviewQueue(db: Database): Promise<ReviewQueueItem[]> {
  // LATERAL: por imagem, escolhe UMA receita do POOL que a mostra (`r.image_id`, #599; o índice parcial de
  // `image_id` atende) — preferindo a do criador da imagem (created_by) e a versão mais recente (versões da
  // linhagem podem herdar a mesma face) — deterministicamente (ORDER BY ... LIMIT 1). Nenhuma receita do pool a
  // mostra ⇒ a imagem fica fora da fila (`ctx.recipe_id is not null`). Junta o dono (LEFT) p/ nome/handle.
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
        where r.image_id = ${recipeImage.id} and ${POOL_RECIPE_SQL}
        order by (r.owner_id is not distinct from ${recipeImage.createdBy}) desc, r.created_at desc
        limit 1
      ) ctx`,
      sql`true`,
    )
    .leftJoin(users, sql`${users.id} = ctx.owner_id`)
    .where(and(eq(recipeImage.reviewRequired, true), isNull(recipeImage.moderatedAt), sql`ctx.recipe_id is not null`))
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
 *
 * Notifica o dono (`image_moderated`, ADR-0051: os Termos, item 8, prometem a notificação em toda retirada),
 * como os caminhos por Report (#373): só na 1ª moderação genuína, pós-commit, best-effort. O dono é o da
 * receita representativa, a MESMA escolha do LATERAL de `listReviewQueue` (a receita do pool que mostra a imagem,
 * #599; entre elas a do criador e a mais recente) — o Curador viu esse dono na fila. Se nenhuma a mostra mais (a
 * receita saiu do pool entre a fila e a remoção), cai para qualquer versão da linhagem: o dono é o mesmo, e os
 * Termos prometem o aviso em toda retirada. Sem receita na linhagem ou de catálogo ⇒ não notifica.
 * A busca desse dono também roda DEPOIS do commit, num try/catch: se falhar, a moderação já valeu e só a
 * notificação se perde (com uma linha no log).
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

  const { result, lineageId, createdBy } = await db.transaction(async (tx) => {
    // Estado atual da imagem (FOR UPDATE serializa moderações concorrentes; tabela única, sem join). A linhagem
    // e o criador resolvem, depois do commit, o dono a notificar.
    const [img] = await tx
      .select({
        moderatedAt: recipeImage.moderatedAt,
        lineageId: recipeImage.lineageId,
        createdBy: recipeImage.createdBy,
      })
      .from(recipeImage)
      .where(eq(recipeImage.id, imageId))
      .for('update')
    if (!img) return { result: { kind: 'not_found' as const }, lineageId: null, createdBy: null }

    // Motivo obrigatório (espelha #133/#18), após existência, antes de qualquer write.
    if (!decideModerationReason({ reason }).allowed)
      return { result: { kind: 'invalid_reason' as const }, lineageId: null, createdBy: null }

    if (img.moderatedAt != null) {
      // Re-moderar preserva a 1ª proveniência e não re-notifica.
      return { result: { kind: 'ok_already_moderated' as const }, lineageId: null, createdBy: null }
    }

    // NUNCA apaga o blob nem zera image_id (ADR-0016): só esconde do público. Owner segue vendo.
    await tx
      .update(recipeImage)
      .set({ moderatedAt: sql`now()`, moderatedReason: reason, moderatedBy: curatorId })
      .where(eq(recipeImage.id, imageId))

    return { result: { kind: 'ok' as const }, lineageId: img.lineageId, createdBy: img.createdBy }
  })

  // Pós-commit, `db` de topo, best-effort (falhar a notificação nunca falha a moderação). Catálogo (owner null)
  // e imagem sem receita na linhagem → pula.
  if (result.kind === 'ok' && lineageId != null) {
    try {
      // Receita representativa — a mesma escolha do LATERAL de `listReviewQueue` (a do pool que mostra a imagem,
      // #599); se nenhuma a mostra mais, cai para qualquer versão da linhagem (mesmo dono).
      const [ctx] = await db
        .select({ recipeId: recipe.id, ownerId: recipe.ownerId })
        .from(recipe)
        .where(eq(recipe.lineageId, lineageId))
        .orderBy(
          sql`(${recipe.imageId} = ${imageId} and ${communityVisibleSqlFragment('recipe')} and ${poolBarriersSqlFragment('recipe')}) desc`,
          sql`(${recipe.ownerId} is not distinct from ${createdBy}) desc`,
          desc(recipe.createdAt),
        )
        .limit(1)
      if (ctx?.ownerId != null) {
        await emitNotification(db, { recipientId: ctx.ownerId, type: 'image_moderated', recipeId: ctx.recipeId })
      }
    } catch (err) {
      // Só nome + código (ADR-0048), como o `emitNotification`: a mensagem do driver traz a query com os parâmetros.
      console.error(`[curate/review] dono da imagem moderada não resolvido (notificação perdida): ${errorLogFields(err)}`)
    }
  }
  return result
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
