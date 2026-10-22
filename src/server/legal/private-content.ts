import { and, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  briefing,
  briefingItem,
  collection,
  creationSession,
  generation,
  mealPlanEntry,
  notification,
  pantryItem,
  recipe,
  recipeImage,
  recipeReview,
  recipeSave,
  shoppingList,
  transcriptMessage,
  userFollow,
} from '@/db/schema'
import { IMAGE_BLOB_COLS, imageRowBlobUrls } from '@/server/images/image-blobs'
import { reapOrphanImage, type Tx } from '@/server/recipe/image'

/**
 * Conteúdo PRIVADO de uma conta eliminada (issue #473, ADR-0049; LGPD Art. 16 e Art. 18 VI;
 * `docs/legal/takedown-e-remocao-titular.md` §6). Núcleo COMPARTILHADO pela eliminação self-service
 * (`eraseOwnAccount`, na mesma tx da anonimização) e pela varredura diária das contas anonimizadas antes
 * desta regra (`purgeAnonymizedPrivateContent`). Roda DENTRO da transação de quem chama e NUNCA toca blob:
 * devolve as URLs para a deleção best-effort DEPOIS do commit (não há rollback de blob).
 *
 * O que sai (só o titular via, ninguém mais depende):
 *  - as Receitas PRIVADAS (ai, web_imported, playful, rascunhos) — cascateiam tradução, ingredientes, tags,
 *    embedding e, se a Receita já foi pública, saves/avaliações/denúncias de TERCEIROS (mesmo efeito do
 *    `deleteOwnRecipe`; as fotos dessas avaliações são coletadas antes e apagadas com o resto);
 *  - a face delas, pelo ref-count de sempre (`reapOrphanImage`: a imagem compartilhada com uma versão
 *    pública por carry-forward FICA) e as imagens de galeria sem referência do titular (`orphanGalleryImage`);
 *  - coleções, saves, listas de compras, follows (nos dois sentidos), notificações recebidas, Plano de
 *    refeições e Despensa.
 *
 * As sessões de criação são LIMPAS, não apagadas: a Transcrição sai inteira, o texto livre, o comentário
 * consultivo e o carimbo do prompt (eixos do Perfil) viram NULL, o Briefing perde os campos e os itens.
 * Apagar a sessão não dá: `generation` é o ledger de custo do texto (#463, painel de custo do /admin), a FK
 * `generation.creation_session_id` é CASCADE (apagar a sessão apagaria o custo calado) e o CHECK
 * `creation_session_structured_briefing_chk` reprova apagar o Briefing (o SET NULL viola o CHECK, 23514).
 * Para conta eliminada, isso supera o "briefing imutável" do ADR-0006. O casco (modelo, tokens, custo) sai
 * pela retenção de 24 meses (`[retencao]`).
 *
 * FICA: as Receitas PÚBLICAS e as avaliações do titular (terceiros dependem delas; o autor aparece
 * anonimizado), as denúncias que ele registrou e as notificações em que ele é o ator (a caixa de quem recebe
 * lê a identidade viva, que colapsa para conta desativada). `ERASURE_POLICY` classifica TODA FK para `users`
 * — FK nova reprova o teste até alguém decidir o que acontece com ela na eliminação.
 *
 * Idempotente: numa conta já limpa todas as contagens dão 0 (`changed: false`) e `privateLeftovers` é falso.
 */

export type PrivateContentCounts = {
  recipes: number
  images: number
  reviewPhotos: number
  transcriptMessages: number
  sessionsScrubbed: number
  generationsScrubbed: number
  briefingsScrubbed: number
  briefingItems: number
  collections: number
  saves: number
  shoppingLists: number
  follows: number
  notifications: number
  mealPlanEntries: number
  pantryItems: number
}

export type PrivateContentPurge = {
  counts: PrivateContentCounts
  /** Só para o hash do evento DSAR_FULFILLED (`fulfillment`); nunca vai para log nem `details`. */
  recipeIds: string[]
  /** Original e derivados das imagens apagadas + as fotos das avaliações que caíram em cascata. */
  blobUrls: string[]
  /** Alguma contagem > 0. */
  changed: boolean
}

/**
 * Destino de cada FK para `users.id` na eliminação. `delete`: a linha sai; `delete_private`: só as
 * privadas; `delete_unreferenced`: só as sem referência (galeria); `scrub`: a linha fica, o texto sai;
 * `keep`: fica (dado de terceiro ou papel de moderação); `keep_ledger`: fica até a retenção do ledger.
 */
export const ERASURE_POLICY = {
  'recipe.owner_id': 'delete_private',
  'recipe.moderated_by': 'keep',
  'recipe.reviewed_by': 'keep',
  'recipe_image.created_by': 'delete_unreferenced',
  'recipe_image.moderated_by': 'keep',
  'image_generation.user_id': 'keep_ledger',
  'extraction_event.user_id': 'keep_ledger',
  'users.image_gen_blocked_by': 'keep',
  'session.user_id': 'delete',
  'account.user_id': 'delete',
  'creation_session.user_id': 'scrub',
  'recipe_save.user_id': 'delete',
  'collection.user_id': 'delete',
  'recipe_review.user_id': 'keep',
  'recipe_review.moderated_by': 'keep',
  'user_follow.follower_id': 'delete',
  'user_follow.followee_id': 'delete',
  'notification.recipient_id': 'delete',
  'notification.actor_id': 'keep',
  'report.reporter_id': 'keep',
  'report.resolved_by': 'keep',
  'dsar_audit_event.actor_id': 'keep_ledger',
  'shopping_list.user_id': 'delete',
  'meal_plan_entry.user_id': 'delete',
  'meal_plan_suggestion_event.user_id': 'keep_ledger',
  'pantry_item.user_id': 'delete',
} as const satisfies Record<string, 'delete' | 'delete_private' | 'delete_unreferenced' | 'scrub' | 'keep' | 'keep_ledger'>

/** O Briefing ainda tem algum campo do pedido. */
const briefingHasContent = or(
  isNotNull(briefing.observacoes),
  isNotNull(briefing.cozinha),
  isNotNull(briefing.porcoes),
  isNotNull(briefing.dificuldade),
  sql`cardinality(${briefing.restricoes}) > 0`,
)!

/**
 * Imagem de galeria do titular SEM referência: nenhuma Receita a usa como face, é dele (`created_by`) ou
 * de uma linhagem cujas Receitas privadas acabaram de sair, e a linhagem NÃO tem Receita de catálogo nem
 * de outro dono (protege a galeria do catálogo quando um Curador elimina a conta). `owner` é o id (string)
 * na eliminação ou `users.id` (correlacionado) na varredura.
 */
export function orphanGalleryImage(owner: string | AnyPgColumn, lineageIds: readonly string[] = []): SQL {
  const mine =
    lineageIds.length > 0
      ? or(eq(recipeImage.createdBy, owner), inArray(recipeImage.lineageId, [...lineageIds]))!
      : eq(recipeImage.createdBy, owner)
  return and(
    mine,
    sql`NOT EXISTS (SELECT 1 FROM ${recipe} WHERE ${recipe.imageId} = ${recipeImage.id})`,
    sql`NOT EXISTS (SELECT 1 FROM ${recipe} WHERE ${recipe.lineageId} = ${recipeImage.lineageId} AND (${recipe.ownerId} IS NULL OR ${recipe.ownerId} <> ${owner}))`,
  )!
}

function existsIn(column: AnyPgColumn, owner: string | AnyPgColumn): SQL {
  return sql`EXISTS (SELECT 1 FROM ${column.table} WHERE ${column} = ${owner})`
}

/**
 * Sobrou conteúdo privado do titular? O OR dos mesmos alvos de `purgePrivateContentInTx` (cada EXISTS anda
 * por um índice que começa pelo dono, menos o da galeria — `recipe_image.created_by` não tem índice, FLAG 10
 * do ADR-0049). Seleciona os candidatos da varredura e é o ponto fixo dos testes: falso depois da limpeza.
 */
export function privateLeftovers(owner: string | AnyPgColumn): SQL {
  const sessionHasText = or(
    isNotNull(creationSession.freeText),
    sql`EXISTS (SELECT 1 FROM ${transcriptMessage} WHERE ${transcriptMessage.creationSessionId} = ${creationSession.id})`,
    sql`EXISTS (SELECT 1 FROM ${generation} WHERE ${generation.creationSessionId} = ${creationSession.id} AND (${generation.advisoryComment} IS NOT NULL OR ${generation.promptStamp} IS NOT NULL))`,
    sql`EXISTS (SELECT 1 FROM ${briefing} WHERE ${briefing.id} = ${creationSession.briefingId} AND ${briefingHasContent})`,
    sql`EXISTS (SELECT 1 FROM ${briefingItem} WHERE ${briefingItem.briefingId} = ${creationSession.briefingId})`,
  )
  return or(
    sql`EXISTS (SELECT 1 FROM ${recipe} WHERE ${recipe.ownerId} = ${owner} AND ${recipe.visibility} = 'private')`,
    sql`EXISTS (SELECT 1 FROM ${creationSession} WHERE ${creationSession.userId} = ${owner} AND (${sessionHasText}))`,
    existsIn(collection.userId, owner),
    existsIn(recipeSave.userId, owner),
    existsIn(shoppingList.userId, owner),
    existsIn(userFollow.followerId, owner),
    existsIn(userFollow.followeeId, owner),
    existsIn(notification.recipientId, owner),
    existsIn(mealPlanEntry.userId, owner),
    existsIn(pantryItem.userId, owner),
    sql`EXISTS (SELECT 1 FROM ${recipeImage} WHERE ${orphanGalleryImage(owner)})`,
  )!
}

/**
 * Apaga/limpa o conteúdo privado de `userId` na tx de quem chama (ordem e motivo no doc do módulo). Não
 * confere `anonymized_at`: quem chama trava a linha `users` e decide.
 */
export async function purgePrivateContentInTx(tx: Tx, userId: string, now: Date): Promise<PrivateContentPurge> {
  const blobUrls: string[] = []
  const isMinePrivate = and(eq(recipe.ownerId, userId), eq(recipe.visibility, 'private'))

  // 1. Trava as Receitas privadas (uma publicação concorrente espera; a que vencer decide o destino).
  const locked = await tx.select({ id: recipe.id }).from(recipe).where(isMinePrivate).for('update')
  const lockedIds = locked.map((r) => r.id)

  let deleted: { id: string; imageId: string | null; lineageId: string }[] = []
  let reviewPhotos = 0
  let reapedImages = 0
  if (lockedIds.length > 0) {
    // 2. Fotos das avaliações nessas Receitas (inclusive de terceiros, se a Receita já foi pública): a linha
    //    cai em cascata com a Receita e o blob ficaria órfão.
    const photos = await tx
      .select({ photoUrl: recipeReview.photoUrl })
      .from(recipeReview)
      .where(and(inArray(recipeReview.recipeId, lockedIds), isNotNull(recipeReview.photoUrl)))
    for (const p of photos) if (p.photoUrl) blobUrls.push(p.photoUrl)
    reviewPhotos = photos.length

    // 3. Apaga, re-afirmando dono e visibilidade na escrita (defesa em profundidade, como `deleteOwnRecipe`).
    deleted = await tx
      .delete(recipe)
      .where(and(inArray(recipe.id, lockedIds), isMinePrivate))
      .returning({ id: recipe.id, imageId: recipe.imageId, lineageId: recipe.lineageId })

    // 4. Faces pelo ref-count de sempre: a imagem que uma versão pública ainda usa (carry-forward) fica. A
    //    face numa linhagem com Receita de catálogo ou de outro dono também fica (é galeria de outra pessoa;
    //    desde o #222 não acontece, mas dado legado pode ter) — a mesma guarda de `orphanGalleryImage`.
    const faceIds = [...new Set(deleted.map((r) => r.imageId).filter((id): id is string => id != null))]
    const foreign =
      faceIds.length > 0
        ? await tx
            .select({ id: recipeImage.id })
            .from(recipeImage)
            .where(
              and(
                inArray(recipeImage.id, faceIds),
                sql`EXISTS (SELECT 1 FROM ${recipe} WHERE ${recipe.lineageId} = ${recipeImage.lineageId} AND (${recipe.ownerId} IS NULL OR ${recipe.ownerId} <> ${userId}))`,
              ),
            )
        : []
    const foreignIds = new Set(foreign.map((f) => f.id))
    for (const imageId of faceIds.filter((id) => !foreignIds.has(id))) {
      const urls = await reapOrphanImage(tx, imageId, null)
      if (urls.length > 0) reapedImages += 1
      blobUrls.push(...urls)
    }
  }

  // 5. Galeria sem referência do titular (inclui a das linhagens que acabaram de perder as privadas).
  const deletedLineages = [...new Set(deleted.map((r) => r.lineageId))]
  const gallery = await tx
    .delete(recipeImage)
    .where(orphanGalleryImage(userId, deletedLineages))
    .returning(IMAGE_BLOB_COLS)
  for (const row of gallery) blobUrls.push(...imageRowBlobUrls(row))

  // 6. Sessões de criação: limpa o texto, mantém o casco do ledger.
  const sessionIds = tx.select({ id: creationSession.id }).from(creationSession).where(eq(creationSession.userId, userId))
  const transcript = await tx
    .delete(transcriptMessage)
    .where(inArray(transcriptMessage.creationSessionId, sessionIds))
    .returning({ id: transcriptMessage.id })
  const generations = await tx
    .update(generation)
    .set({ advisoryComment: null, promptStamp: null })
    .where(
      and(
        inArray(generation.creationSessionId, sessionIds),
        or(isNotNull(generation.advisoryComment), isNotNull(generation.promptStamp)),
      ),
    )
    .returning({ id: generation.id })
  const sessions = await tx
    .update(creationSession)
    .set({ freeText: null, updatedAt: now })
    .where(and(eq(creationSession.userId, userId), isNotNull(creationSession.freeText)))
    .returning({ id: creationSession.id })
  // Cada sessão estruturada cria o PRÓPRIO Briefing (`insertBriefing`); nada mais aponta para ele.
  const briefingIds = tx
    .select({ id: creationSession.briefingId })
    .from(creationSession)
    .where(and(eq(creationSession.userId, userId), isNotNull(creationSession.briefingId)))
  const items = await tx
    .delete(briefingItem)
    .where(inArray(briefingItem.briefingId, briefingIds))
    .returning({ id: briefingItem.id })
  const briefings = await tx
    .update(briefing)
    .set({ observacoes: null, restricoes: [], cozinha: null, porcoes: null, dificuldade: null })
    .where(and(inArray(briefing.id, briefingIds), briefingHasContent))
    .returning({ id: briefing.id })

  // 7. O resto é só do titular: sai inteiro (itens de coleção e de lista caem em cascata).
  const collections = await tx.delete(collection).where(eq(collection.userId, userId)).returning({ id: collection.id })
  const saves = await tx.delete(recipeSave).where(eq(recipeSave.userId, userId)).returning({ id: recipeSave.recipeId })
  const lists = await tx.delete(shoppingList).where(eq(shoppingList.userId, userId)).returning({ id: shoppingList.id })
  const follows = await tx
    .delete(userFollow)
    .where(or(eq(userFollow.followerId, userId), eq(userFollow.followeeId, userId)))
    .returning({ id: userFollow.followerId })
  const notifications = await tx
    .delete(notification)
    .where(eq(notification.recipientId, userId))
    .returning({ id: notification.id })
  // Plano de refeições (ADR-0035 dec.6) e Despensa (ADR-0038 dec.7): privados, ninguém mais depende.
  const mealPlan = await tx.delete(mealPlanEntry).where(eq(mealPlanEntry.userId, userId)).returning({ id: mealPlanEntry.id })
  const pantry = await tx.delete(pantryItem).where(eq(pantryItem.userId, userId)).returning({ id: pantryItem.id })

  const counts: PrivateContentCounts = {
    recipes: deleted.length,
    images: reapedImages + gallery.length,
    reviewPhotos,
    transcriptMessages: transcript.length,
    sessionsScrubbed: sessions.length,
    generationsScrubbed: generations.length,
    briefingsScrubbed: briefings.length,
    briefingItems: items.length,
    collections: collections.length,
    saves: saves.length,
    shoppingLists: lists.length,
    follows: follows.length,
    notifications: notifications.length,
    mealPlanEntries: mealPlan.length,
    pantryItems: pantry.length,
  }
  return {
    counts,
    recipeIds: deleted.map((r) => r.id),
    blobUrls,
    changed: Object.values(counts).some((n) => n > 0),
  }
}
