import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import type { ImageGenerator } from '@/server/images/image-generator'
import type { GalleryImage } from '@/domain/recipe-read'
import { loadImageGenConfig } from '@/server/app-config'
import { loadRecipeRows } from '@/server/recipe/load'
import {
  generateAndStoreGalleryImage,
  createGalleryImage,
  loadGallery,
  deleteOrphanBlob,
} from '@/server/recipe/image'

/**
 * Estúdio de imagem do CATÁLOGO (#238, ADR-0026 emenda dec.10) — variante CURADOR das ops de imagem.
 * Hoje todo caminho de imagem gateia `ownerId === userId` ⇒ catálogo (`owner_id IS NULL`) sempre 404.
 * Aqui o gate é `origin='catalog' && owner_id IS NULL` (defense-in-depth — não afrouxa p/ um só) e a
 * AUTORIZAÇÃO é da BORDA (`requireRole('curador')`). Rotas de DONO ficam byte-idênticas (zero
 * regressão no caminho pago). Reusa o NÚCLEO compartilhado (`generateAndStoreGalleryImage`,
 * `createGalleryImage`, `loadGallery`, `deleteOrphanBlob`) — só os WRAPPERS de autorização mudam.
 *
 * Decisões: (dec.11) geração de catálogo é QUOTA-EXEMPT (não aplica teto por papel nem o bloqueio
 * por-usuário #226 — é op administrativa, não abuso) mas respeita o kill-switch global #134
 * (`enabled`) e ESCREVE no ledger (custo). (dec.10) catálogo AUTO-SELECIONA a face (insert+ledger+
 * select numa única tx no núcleo ⇒ sem cobrança dupla). O `actor` (created_by/ledger) é o `curatorId`
 * (user real); a autorização é `origin='catalog'`, não posse. Cada mutação DEVOLVE a galeria atualizada
 * (top-level) — o `RecipeImageManager mode='catalog'` re-renderiza do retorno (NÃO `router.refresh()`,
 * a fila é client-fetched).
 */

export type CatalogImageResult =
  | { kind: 'ok'; gallery: GalleryImage[] }
  | { kind: 'not_found' } //  404 — inexistente / não-catálogo (leak-safe)
  | { kind: 'storage' } //    503 — ImageStore indisponível
export type CatalogImageGenResult = CatalogImageResult | { kind: 'disabled' } | { kind: 'generator' }
export type CatalogImageSelectResult = CatalogImageResult | { kind: 'moderated' }
export type CatalogGalleryDeleteResult = CatalogImageResult | { kind: 'in_use' }

/** Gate barato de catálogo: `origin='catalog' && owner_id IS NULL` + lineage/face. null ⇒ 404. */
async function loadCatalogGate(
  db: Database,
  id: string,
): Promise<{ lineageId: string; imageId: string | null } | null> {
  const [g] = await db
    .select({
      origin: recipe.origin,
      ownerId: recipe.ownerId,
      imageId: recipe.imageId,
      lineageId: recipe.lineageId,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!g || g.origin !== 'catalog' || g.ownerId != null) return null
  return { lineageId: g.lineageId, imageId: g.imageId }
}

async function okWithGallery(
  db: Database,
  lineageId: string,
  selectedImageId: string | null,
): Promise<{ kind: 'ok'; gallery: GalleryImage[] }> {
  return { kind: 'ok', gallery: await loadGallery(db, lineageId, selectedImageId) }
}

/**
 * GERAR imagem por IA p/ um rascunho de catálogo (curador). Carrega o conteúdo (titulo/cozinha/
 * categoria/ingredientes) p/ ancorar o prompt; respeita o kill-switch global (#134); PULA quota/
 * bloqueio (dec.11); AUTO-SELECIONA a face (núcleo, autoSelect=true). Devolve a galeria atualizada.
 */
export async function applyCatalogImageGeneration(input: {
  db: Database
  store: ImageStore
  generator: ImageGenerator
  id: string // já validado uuid pela borda
  curatorId: string // session.user.id (route passou por requireRole 'curador')
  promptOverride?: string
}): Promise<CatalogImageGenResult> {
  const { db, store, generator, id, curatorId, promptOverride } = input

  const rows = await loadRecipeRows(db, id)
  if (!rows || rows.recipe.origin !== 'catalog' || rows.recipe.ownerId != null) {
    return { kind: 'not_found' }
  }
  // #134: kill-switch GLOBAL respeitado (se o admin desligou a geração, vale p/ catálogo também).
  const genConfig = await loadImageGenConfig(db)
  if (!genConfig.enabled) return { kind: 'disabled' }

  const lineageId = rows.recipe.lineageId ?? ''
  const core = await generateAndStoreGalleryImage({
    db,
    store,
    generator,
    recipeId: id,
    lineageId,
    actorUserId: curatorId,
    content: {
      titulo: rows.translations.find((t) => t.locale === rows.recipe.originalLocale)?.titulo ?? '',
      cozinha: rows.recipe.cozinha ?? null,
      categoria: rows.recipe.categoria ?? null,
      ingredientes: rows.ingredients.map((i) => i.rawText ?? '').filter((s) => s.length > 0),
    },
    model: genConfig.model,
    promptOverride,
    reviewRequired: false, // catálogo: o curador É o revisor; não enfileira na fila proativa
    autoSelect: true, // catálogo seta a face na mesma tx (sem cobrança dupla)
  })
  if (core.kind !== 'ok') return core // generator | storage | not_found(TOCTOU)
  return okWithGallery(db, lineageId, core.imageId)
}

/** SUBIR foto p/ um rascunho de catálogo (curador). Cria recipe_image (user_photo) + AUTO-SELECIONA. */
export async function applyCatalogImageUpload(input: {
  db: Database
  store: ImageStore
  id: string
  curatorId: string
  data: Buffer
  contentType: string
}): Promise<CatalogImageResult> {
  const { db, store, id, curatorId, data, contentType } = input

  const gate = await loadCatalogGate(db, id)
  if (!gate) return { kind: 'not_found' }

  let blobUrl: string
  try {
    ;({ url: blobUrl } = await store.store({ data, contentType, pathPrefix: 'recipes' }))
  } catch {
    return { kind: 'storage' }
  }

  let newImageId: string
  try {
    newImageId = await db.transaction(async (tx) => {
      const imageId = await createGalleryImage(tx, {
        blobUrl,
        provenance: 'user_photo',
        userId: curatorId,
        lineageId: gate.lineageId,
      })
      // Auto-seleciona. Escopa por owner_id IS NULL (defense-in-depth — espelha o owner_id=userId do dono).
      await tx
        .update(recipe)
        .set({ imageId, updatedAt: new Date() })
        .where(and(eq(recipe.id, id), sql`${recipe.ownerId} IS NULL`))
      return imageId
    })
  } catch (err) {
    await deleteOrphanBlob(store, blobUrl)
    throw err
  }

  return okWithGallery(db, gate.lineageId, newImageId)
}

/** SELECIONAR uma imagem da galeria como face (curador). Bloqueia imagem moderada (#225). */
export async function applyCatalogImageSelect(input: {
  db: Database
  id: string
  imageId: string
}): Promise<CatalogImageSelectResult> {
  const { db, id, imageId } = input

  const gate = await loadCatalogGate(db, id)
  if (!gate) return { kind: 'not_found' }

  const [img] = await db
    .select({ id: recipeImage.id, moderatedAt: recipeImage.moderatedAt })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, imageId), eq(recipeImage.lineageId, gate.lineageId)))
    .limit(1)
  if (!img) return { kind: 'not_found' }
  if (img.moderatedAt != null) return { kind: 'moderated' }

  await db
    .update(recipe)
    .set({ imageId, updatedAt: new Date() })
    .where(and(eq(recipe.id, id), sql`${recipe.ownerId} IS NULL`))
  return okWithGallery(db, gate.lineageId, imageId)
}

/** REMOVER a face (deselecionar, #222) — zera image_id; a imagem fica na galeria. Idempotente. */
export async function applyCatalogImageRemoval(input: {
  db: Database
  id: string
}): Promise<CatalogImageResult> {
  const { db, id } = input
  const gate = await loadCatalogGate(db, id)
  if (!gate) return { kind: 'not_found' }
  await db
    .update(recipe)
    .set({ imageId: null, updatedAt: new Date() })
    .where(and(eq(recipe.id, id), sql`${recipe.ownerId} IS NULL`))
  return okWithGallery(db, gate.lineageId, null)
}

/** APAGAR uma imagem da galeria (curador) — bloqueada se ALGUMA versão ainda a referencia (#222). */
export async function applyCatalogGalleryImageDelete(input: {
  db: Database
  store: ImageStore
  id: string
  imageId: string
}): Promise<CatalogGalleryDeleteResult> {
  const { db, store, id, imageId } = input

  const gate = await loadCatalogGate(db, id)
  if (!gate) return { kind: 'not_found' }

  const [img] = await db
    .select({ blobUrl: recipeImage.blobUrl })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, imageId), eq(recipeImage.lineageId, gate.lineageId)))
    .limit(1)
  if (!img) return { kind: 'not_found' }

  // Ref-count GLOBAL numa tx (evita corrida COUNT↔DELETE). Uma imagem em uso (= face de alguma
  // versão) ⇒ in_use; logo a face atual NUNCA é apagável ⇒ `gate.imageId` segue válido p/ a galeria.
  const orphanBlobUrl = await db.transaction(async (tx) => {
    const [{ refs }] = await tx
      .select({ refs: sql<number>`count(*)::int` })
      .from(recipe)
      .where(eq(recipe.imageId, imageId))
    if (refs > 0) return null
    await tx.delete(recipeImage).where(eq(recipeImage.id, imageId))
    return img.blobUrl
  })
  if (orphanBlobUrl === null) return { kind: 'in_use' }

  await deleteOrphanBlob(store, orphanBlobUrl)
  return okWithGallery(db, gate.lineageId, gate.imageId)
}
