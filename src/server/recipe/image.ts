import { and, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, imageGeneration } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import type { ImageGenerator } from '@/server/images/image-generator'
import type { RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import type { ImageProvenance } from '@/domain/recipe'
import type { Role } from '@/domain/user'
import { decideImageQuota, IMAGE_GEN_WINDOW_MS } from '@/domain/image-quota'
import { capFromConfig } from '@/domain/image-gen-config'
import { buildDishImagePrompt } from '@/domain/image-prompt'
import { loadRecipeRows } from '@/server/recipe/load'
import { loadImageGenConfig } from '@/server/app-config'

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

  // 3. Cria a recipe_image (user_photo), repointa a Receita e reaproveita a antiga (ref-count).
  return persistAndPointImage(db, store, {
    id,
    userId,
    blobUrl,
    provenance: 'user_photo',
    oldImageId,
    requestLocale,
  })
}

/**
 * Geração de imagem por IA (issue #132, ADR-0017). Owner-only; respeita o TETO por papel na janela
 * 24h deslizante (countdown ao estourar); monta o prompt da receita (ou usa o editado pelo usuário);
 * Gemini → bytes → ImageStore → `recipe_image` (`ai_generated`) → `image_id` (ref-counted como o
 * upload). A degradação dos seams é tratada (generator/storage → erro estruturado, não 500 cru).
 */
export type RecipeImageGenResult =
  | { kind: 'ok'; view: RecipeView } //               200 — view montada
  | { kind: 'not_found' } //                          404 — inexistente / não-dono / catálogo
  | { kind: 'disabled' } //                           403 — geração desligada na config (#134)
  | { kind: 'storage' } //                            503 — ImageStore indisponível
  | { kind: 'generator' } //                          503 — geração por IA indisponível
  | { kind: 'quota'; retryAfterMs: number } //        429 — teto estourado (countdown)

export async function applyRecipeImageGeneration(input: {
  db: Database
  store: ImageStore
  generator: ImageGenerator
  id: string // já validado uuid pelo route
  userId: string // session.user.id
  role: Role | null // papel do dono (define o teto); null ⇒ fail-closed no teto de `usuario`
  promptOverride?: string // prompt editado pelo usuário (refino); ausente ⇒ um-clique (monta da receita)
  requestLocale: string
}): Promise<RecipeImageGenResult> {
  const { db, store, generator, id, userId, role, promptOverride, requestLocale } = input
  const now = new Date()

  // 1. Carrega a receita (espinha + traduções + ingredientes) e prova ownership (404 leak-safe).
  //    O gate de dono vem ANTES de tocar o gerador (caro) ⇒ anon/não-dono nunca disparam o seam.
  const rows = await loadRecipeRows(db, id)
  if (!rows || rows.recipe.ownerId == null || rows.recipe.ownerId !== userId) return { kind: 'not_found' }

  // 2. Config de geração (#134): enabled/model/teto vêm do singleton app_config (defaults em código
  //    quando não há linha). Geração DESLIGADA ⇒ 403 ANTES de tocar o seam (a UI também esconde a ação).
  const genConfig = await loadImageGenConfig(db)
  if (!genConfig.enabled) return { kind: 'disabled' }

  // 3. Teto por papel, janela 24h deslizante (ADR-0017) — agora da CONFIG (#134, era fixo na #132).
  //    Conta os EVENTOS de geração do usuário na janela (ledger imutável) — imagem moderada/substituída
  //    AINDA conta (custo já gasto). cap ∞ (papel ilimitado) pula a query. Estourou ⇒ 429 com countdown.
  const cap = capFromConfig(genConfig.dailyCapByRole, role)
  if (Number.isFinite(cap)) {
    const recentAt = await loadRecentAiGenAt(db, userId, now)
    const quota = decideImageQuota({ cap, recentAt, now })
    if (!quota.allowed) return { kind: 'quota', retryAfterMs: quota.retryAfterMs }
  }

  // 4. Prompt: o editado pelo usuário (refino), senão montado da receita ATUAL (um-clique).
  const prompt =
    promptOverride?.trim() ||
    buildDishImagePrompt({
      titulo: rows.translations.find((t) => t.locale === rows.recipe.originalLocale)?.titulo ?? '',
      cozinha: rows.recipe.cozinha ?? null,
      categoria: rows.recipe.categoria ?? null,
      ingredientes: rows.ingredients.map((i) => i.rawText ?? '').filter((s) => s.length > 0),
    })

  // 5. Gera (Gemini REST) com o MODELO da config (#134). Falha ⇒ degradação 503 (nenhuma linha nasce
  //    ⇒ nenhum slot consumido).
  let generated
  try {
    generated = await generator.generateDishImage({ prompt, model: genConfig.model })
  } catch {
    return { kind: 'generator' }
  }

  // 6. Guarda os bytes no blob. Falha ⇒ 503 storage.
  let blobUrl: string
  try {
    ;({ url: blobUrl } = await store.store({
      data: generated.data,
      contentType: generated.contentType,
      pathPrefix: 'recipes',
    }))
  } catch {
    return { kind: 'storage' }
  }

  // 7. Cria recipe_image (ai_generated) + repointa + reaproveita a antiga (mesma máquina do upload).
  return persistAndPointImage(db, store, {
    id,
    userId,
    blobUrl,
    provenance: 'ai_generated',
    oldImageId: rows.recipe.imageId ?? null,
    requestLocale,
  })
}

/**
 * Núcleo compartilhado upload/geração: numa transação, cria a `recipe_image` (proveniência dada),
 * aponta `recipe.image_id` pra ela e — se a anterior ficou SEM referência — apaga a LINHA antiga,
 * devolvendo o blob órfão pra deleção pós-commit (best-effort). Se a tx falhar DEPOIS do store, o
 * blob NOVO ficaria órfão (o reap só mira o ANTIGO) ⇒ limpa best-effort e relança (500 honesto).
 */
async function persistAndPointImage(
  db: Database,
  store: ImageStore,
  args: {
    id: string
    userId: string
    blobUrl: string
    provenance: ImageProvenance
    oldImageId: string | null
    requestLocale: string
  },
): Promise<RecipeImageResult> {
  const { id, userId, blobUrl, provenance, oldImageId, requestLocale } = args
  let orphanBlobUrl: string | null
  try {
    orphanBlobUrl = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(recipeImage)
        .values({ blobUrl, provenance, createdBy: userId })
        .returning({ id: recipeImage.id })

      // #132: registra o EVENTO de geração no ledger imutável (ATÔMICO com a criação da imagem) —
      // o teto conta daqui (NÃO de recipe_image, que é reapado). Custo gasto = linha permanente:
      // regenerar/substituir/moderar NÃO devolve o slot (ADR-0017). Só pra ai_generated (custo).
      if (provenance === 'ai_generated') {
        await tx.insert(imageGeneration).values({ userId })
      }

      // E5: reimpõe ownership na escrita (espelha visibility.ts) — defesa-em-profundidade.
      await tx
        .update(recipe)
        .set({ imageId: created.id, updatedAt: new Date() })
        .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId)))

      return reapOrphanImage(tx, oldImageId, created.id)
    })
  } catch (err) {
    await deleteOrphanBlob(store, blobUrl)
    throw err
  }

  await deleteOrphanBlob(store, orphanBlobUrl)
  return buildView(db, id, requestLocale, userId)
}

/**
 * `created_at` dos EVENTOS de geração do usuário na janela 24h (insumo do teto). Lê do LEDGER
 * imutável `image_generation` (NÃO de `recipe_image`, que é reapado): assim regenerar/substituir/
 * moderar a imagem NÃO devolve o slot — o custo já gasto conta na janela (ADR-0017).
 */
async function loadRecentAiGenAt(db: Database, userId: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - IMAGE_GEN_WINDOW_MS)
  const rows = await db
    .select({ createdAt: imageGeneration.createdAt })
    .from(imageGeneration)
    .where(and(eq(imageGeneration.userId, userId), gte(imageGeneration.createdAt, since)))
  return rows.map((r) => r.createdAt)
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
