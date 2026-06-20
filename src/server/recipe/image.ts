import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import type { RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import { loadRecipeRows } from '@/server/recipe/load'

/**
 * Núcleo com efeito da Imagem da receita (issue #130, ADR-0016) — upload/troca/remoção da foto do
 * prato pelo Owner. Espelha o estilo de `visibility.ts`/`moderation.ts`: discriminated union que o
 * route mapeia para HTTP, ownership como autorização (catálogo/não-dono ⇒ `not_found`, NUNCA 403 —
 * não vaza existência, ADR-0011), e a VIEW já montada no sucesso (mesma forma do GET).
 *
 * A Imagem é ENTIDADE `recipe_image` (NUNCA coluna-URL): o upload cria uma linha (`user_photo`) e
 * aponta `recipe.image_id` pra ela. O blob é REF-COUNTED — ao trocar/remover, o blob antigo só é
 * apagado quando NENHUMA linha de `recipe` ainda referencia aquele `image_id` (futuro carry-forward
 * de #131 fará várias versões compartilharem uma imagem; este código já conta certo). A escrita no
 * banco (criar imagem + repontar + reaproveitar/apagar a linha órfã) roda em UMA transação; a
 * deleção do BLOB é best-effort DEPOIS do commit (não há rollback de blob).
 */

export type RecipeImageResult =
  | { kind: 'ok'; view: RecipeView } // 200 — view montada (mesma forma do GET)
  | { kind: 'not_found' } //           404 — inexistente / não-dono / catálogo
  | { kind: 'storage' } //             503 — storage de imagem indisponível (degradação do seam)

/** Tipo da transação do Drizzle (mesmas APIs de query que `Database`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

export async function applyRecipeImageUpload(input: {
  db: Database
  store: ImageStore
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  data: Buffer
  contentType: string
  requestLocale: string
}): Promise<RecipeImageResult> {
  const { db, store, id, userId, data, contentType, requestLocale } = input

  // 1. Gate barato: dono + image_id atual. Catálogo (ownerId NULL) ou dono diferente ⇒ 404.
  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }
  const oldImageId = gate.imageId

  // 2. Guarda o blob ANTES de qualquer escrita no banco: se o storage falhar, nada mudou (503).
  let blobUrl: string
  try {
    ;({ url: blobUrl } = await store.store({ data, contentType, pathPrefix: 'recipes' }))
  } catch {
    return { kind: 'storage' }
  }

  // 3. Tx: cria a nova imagem, aponta a Receita pra ela, e — se a antiga ficou SEM referência —
  //    apaga a LINHA recipe_image antiga, devolvendo o blob órfão pra deleção pós-commit.
  let orphanBlobUrl: string | null
  try {
    orphanBlobUrl = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(recipeImage)
        .values({ blobUrl, provenance: 'user_photo', createdBy: userId })
        .returning({ id: recipeImage.id })

      // E5: reimpõe ownership na escrita (espelha visibility.ts) — defesa-em-profundidade.
      await tx
        .update(recipe)
        .set({ imageId: created.id, updatedAt: new Date() })
        .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId)))

      return reapOrphanImage(tx, oldImageId, created.id)
    })
  } catch (err) {
    // A tx falhou DEPOIS de guardarmos o blob NOVO: nenhuma linha o referencia ⇒ ele ficaria
    // órfão (o reapOrphanImage só mira o blob ANTIGO). Limpa best-effort e relança — um erro de
    // DB real continua 500 honesto (não mascaramos de 503), mas sem deixar blob pendurado.
    await deleteOrphanBlob(store, blobUrl)
    throw err
  }

  // 4. Apaga o blob órfão (best-effort, fora da tx — não há rollback de blob; só o que é nosso).
  await deleteOrphanBlob(store, orphanBlobUrl)

  // 5. View atualizada (mesma forma do GET; viewerId = dono ⇒ traz canManage etc.).
  return buildView(db, id, requestLocale, userId)
}

export async function applyRecipeImageRemoval(input: {
  db: Database
  store: ImageStore
  id: string
  userId: string
  requestLocale: string
}): Promise<RecipeImageResult> {
  const { db, store, id, userId, requestLocale } = input

  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }
  const oldImageId = gate.imageId

  // Remover sem imagem é no-op idempotente (devolve a view; nada a apagar).
  const orphanBlobUrl = await db.transaction(async (tx) => {
    await tx
      .update(recipe)
      .set({ imageId: null, updatedAt: new Date() })
      .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId)))
    return reapOrphanImage(tx, oldImageId, null)
  })

  await deleteOrphanBlob(store, orphanBlobUrl)

  return buildView(db, id, requestLocale, userId)
}

/** Gate barato compartilhado: dono + image_id atual da Receita (ou null se inexistente). */
async function loadOwnerGate(
  db: Database,
  id: string,
): Promise<{ ownerId: string | null; imageId: string | null } | null> {
  const [gate] = await db
    .select({ ownerId: recipe.ownerId, imageId: recipe.imageId })
    .from(recipe)
    .where(eq(recipe.id, id))
  return gate ?? null
}

/**
 * Ref-count: a imagem ANTERIOR (`oldImageId`) ficou órfã? A Receita JÁ foi repontada (para
 * `newImageId` ou NULL) ANTES desta chamada, então `COUNT(recipe WHERE image_id = old)` exclui a
 * linha atual e conta só OUTRAS versões que ainda compartilham o blob (carry-forward #131). Zero
 * refs ⇒ apaga a LINHA recipe_image e devolve o `blob_url` (pra deleção pós-commit do blob); >0 ⇒
 * mantém (outra versão ainda usa) e devolve null. No-op quando não havia imagem ou ela não mudou.
 */
async function reapOrphanImage(
  tx: Tx,
  oldImageId: string | null,
  newImageId: string | null,
): Promise<string | null> {
  if (oldImageId == null || oldImageId === newImageId) return null
  const [{ refs }] = await tx
    .select({ refs: sql<number>`count(*)::int` })
    .from(recipe)
    .where(eq(recipe.imageId, oldImageId))
  if (refs > 0) return null
  const [old] = await tx
    .select({ blobUrl: recipeImage.blobUrl })
    .from(recipeImage)
    .where(eq(recipeImage.id, oldImageId))
  await tx.delete(recipeImage).where(eq(recipeImage.id, oldImageId))
  return old?.blobUrl ?? null
}

/** Apaga o blob órfão se houver E se for NOSSO (no-op silencioso para URL estrangeira/ausente). */
async function deleteOrphanBlob(store: ImageStore, blobUrl: string | null): Promise<void> {
  if (!blobUrl || !store.owns(blobUrl)) return
  try {
    await store.delete(blobUrl)
  } catch {
    // Órfão tolerável: a Receita já foi repontada/limpa; não propagamos a falha de limpeza.
  }
}

/** Monta a view atualizada (mesma forma do GET, viewerId = dono). `not_found` em corrida improvável. */
async function buildView(
  db: Database,
  id: string,
  requestLocale: string,
  userId: string,
): Promise<RecipeImageResult> {
  const rows = await loadRecipeRows(db, id)
  if (!rows) return { kind: 'not_found' }
  return { kind: 'ok', view: resolveRecipeView({ ...rows, requestLocale, viewerId: userId }) }
}
