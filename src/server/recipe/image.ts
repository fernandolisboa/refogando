import { and, asc, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, imageGeneration } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import type { ImageGenerator } from '@/server/images/image-generator'
import type { GalleryImage, RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import type { ImageProvenance } from '@/domain/recipe'
import type { Role } from '@/domain/user'
import { decideImageQuota, IMAGE_GEN_WINDOW_MS } from '@/domain/image-quota'
import { capFromConfig } from '@/domain/image-gen-config'
import { buildDishImagePrompt, composeImagePrompt } from '@/domain/image-prompt'
import { loadRecipeRows } from '@/server/recipe/load'
import { loadImageGenConfig } from '@/server/app-config'

/**
 * Núcleo com efeito da Imagem da receita (#130/#132/#222, ADR-0016/0017/0022) — o ESTÚDIO de imagem
 * do Owner. Espelha o estilo de `visibility.ts`/`moderation.ts`: discriminated union que o route
 * mapeia para HTTP, ownership como autorização (catálogo/não-dono ⇒ `not_found`, NUNCA 403 — não
 * vaza existência, ADR-0011), e a VIEW já montada no sucesso (mesma forma do GET).
 *
 * A Imagem é ENTIDADE `recipe_image` (NUNCA coluna-URL), com uma GALERIA por LINHAGEM (#222): cada
 * Receita R tem a galeria `recipe_image WHERE lineage_id = R.lineage_id`. Gerar/enviar ACRESCENTA à
 * galeria e NUNCA descarta a anterior (o reap-on-swap saiu de cena — ADR-0022 dec.1/4). Uma imagem é
 * a SELECIONADA (`recipe.image_id`) = a única face pública:
 *  - GERAR = PREVIEW (#222): cria uma `recipe_image` DESELECIONADA (ai_generated), grava o ledger,
 *    NÃO toca `image_id`, NÃO reapa; devolve só a imagem (a face só muda no "Usar esta"/select).
 *  - ENVIAR (upload) = deliberado: cria a `recipe_image` (user_photo) e AUTO-SELECIONA (image_id).
 *  - SELECIONAR (#222): repointa `image_id` para uma imagem da MESMA linhagem (custo zero, sem reap).
 *  - APAGAR (#222): a ÚNICA op destrutiva — apaga a linha + reapa o blob, BLOQUEADA quando a imagem
 *    ainda é referenciada por ALGUMA versão (ref-count GLOBAL, ADR-0016).
 *  - REMOVER (DELETE /image) = DESELECIONAR: zera `image_id` (volta ao placeholder), NÃO apaga nada
 *    (a imagem fica na galeria, re-selecionável).
 *
 * `reapOrphanImage` PERMANECE — reusado pelo HARD-delete da Receita (#146, owner-edit.ts) + pelo
 * gallery-delete novo. A escrita no banco roda em UMA transação; a deleção do BLOB é best-effort
 * DEPOIS do commit (não há rollback de blob).
 */

export type RecipeImageResult =
  | { kind: 'ok'; view: RecipeView } // 200 — view montada (mesma forma do GET)
  | { kind: 'not_found' } //           404 — inexistente / não-dono / catálogo / lineage estrangeira
  | { kind: 'storage' } //             503 — storage de imagem indisponível (degradação do seam)

/** Resultado do gallery-delete (#222): inclui `in_use` (409) além do `ok`/`not_found`. */
export type RecipeGalleryDeleteResult = RecipeImageResult | { kind: 'in_use' }

/** Resultado da GERAÇÃO-como-preview (#222): NÃO devolve view (a face não mudou) — só a imagem. */
export type RecipeImageGenResult =
  | { kind: 'ok'; image: GalleryImage } //            200 — a imagem gerada (deselecionada/preview)
  | { kind: 'not_found' } //                          404 — inexistente / não-dono / catálogo
  | { kind: 'disabled' } //                           403 — geração desligada na config (#134)
  | { kind: 'storage' } //                            503 — ImageStore indisponível
  | { kind: 'generator' } //                          503 — geração por IA indisponível
  | { kind: 'quota'; retryAfterMs: number } //        429 — teto estourado (countdown)

/** Tipo da transação do Drizzle (mesmas APIs de query que `Database`). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

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

  // 1. Gate barato: dono + lineage_id. Catálogo (ownerId NULL) ou dono diferente ⇒ 404.
  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  // 2. Guarda o blob ANTES de qualquer escrita no banco: se o storage falhar, nada mudou (503).
  let blobUrl: string
  try {
    ;({ url: blobUrl } = await store.store({ data, contentType, pathPrefix: 'recipes' }))
  } catch {
    return { kind: 'storage' }
  }

  // 3. Cria a recipe_image (user_photo) na linhagem e AUTO-SELECIONA (image_id). NÃO reapa (#222).
  try {
    await db.transaction(async (tx) => {
      const imageId = await createGalleryImage(tx, {
        blobUrl,
        provenance: 'user_photo',
        userId,
        lineageId: gate.lineageId,
      })
      // E5: reimpõe ownership na escrita (espelha visibility.ts) — defesa-em-profundidade.
      await tx
        .update(recipe)
        .set({ imageId, updatedAt: new Date() })
        .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId)))
    })
  } catch (err) {
    // A tx falhou DEPOIS do store ⇒ o blob NOVO ficou órfão. Limpa best-effort e relança (500 honesto).
    await deleteOrphanBlob(store, blobUrl)
    throw err
  }

  return buildView(db, id, requestLocale, userId)
}

/**
 * Geração de imagem por IA = PREVIEW (#132/#222, ADR-0017/0022). Owner-only; respeita o TETO por
 * papel na janela 24h deslizante (countdown ao estourar); monta o prompt SEMPRE ancorado na receita
 * (#214). Gemini → bytes → ImageStore → `recipe_image` (`ai_generated`) ACRESCENTADA à galeria
 * (DESELECIONADA — NÃO toca `image_id`, NÃO reapa). O ledger imutável é gravado (o teto conta o
 * ledger; ADR-0017 "não devolve slot"). Devolve só a imagem gerada (a face só muda no select).
 */
export async function applyRecipeImageGeneration(input: {
  db: Database
  store: ImageStore
  generator: ImageGenerator
  id: string // já validado uuid pelo route
  userId: string // session.user.id
  role: Role | null // papel do dono (define o teto); null ⇒ fail-closed no teto de `usuario`
  promptOverride?: string // prompt editado pelo usuário (refino); ausente ⇒ um-clique (monta da receita)
}): Promise<RecipeImageGenResult> {
  const { db, store, generator, id, userId, role, promptOverride } = input
  const now = new Date()

  // 1. Carrega a receita (espinha + traduções + ingredientes) e prova ownership (404 leak-safe).
  //    O gate de dono vem ANTES de tocar o gerador (caro) ⇒ anon/não-dono nunca disparam o seam.
  const rows = await loadRecipeRows(db, id)
  if (!rows || rows.recipe.ownerId == null || rows.recipe.ownerId !== userId) return { kind: 'not_found' }

  // 2. Config de geração (#134): geração DESLIGADA ⇒ 403 ANTES de tocar o seam (a UI também esconde).
  const genConfig = await loadImageGenConfig(db)
  if (!genConfig.enabled) return { kind: 'disabled' }

  // 3. Teto por papel, janela 24h deslizante (ADR-0017) — da CONFIG (#134). Conta os EVENTOS do
  //    ledger imutável na janela. cap ∞ pula a query. Estourou ⇒ 429 com countdown (ANTES do seam).
  const cap = capFromConfig(genConfig.dailyCapByRole, role)
  if (Number.isFinite(cap)) {
    const recentAt = await loadRecentAiGenAt(db, userId, now)
    const quota = decideImageQuota({ cap, recentAt, now })
    if (!quota.allowed) return { kind: 'quota', retryAfterMs: quota.retryAfterMs }
  }

  // 4. Prompt: SEMPRE ancorado na receita ATUAL (#214). O base é montado PRIMEIRO; o override do
  //    usuário NUNCA o substitui — vira sufixo de estilo trimado/limitado (composeImagePrompt).
  const base = buildDishImagePrompt({
    titulo: rows.translations.find((t) => t.locale === rows.recipe.originalLocale)?.titulo ?? '',
    cozinha: rows.recipe.cozinha ?? null,
    categoria: rows.recipe.categoria ?? null,
    ingredientes: rows.ingredients.map((i) => i.rawText ?? '').filter((s) => s.length > 0),
  })
  const prompt = composeImagePrompt(base, promptOverride)

  // 5. Gera (Gemini REST) com o MODELO da config. Falha ⇒ 503 (nenhuma linha nasce ⇒ nenhum slot).
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

  // 7. ACRESCENTA a `recipe_image` (ai_generated) à galeria + grava o ledger — DESELECIONADA (NÃO
  //    toca `image_id`, NÃO reapa). A face só muda no "Usar esta" (select). Se a tx falhar, o blob
  //    novo fica órfão ⇒ limpa best-effort e relança (500 honesto).
  // `lineage_id` é NOT NULL no banco; o `?? ''` só satisfaz o tipo opcional do RecipeRow puro.
  const lineageId = rows.recipe.lineageId ?? ''
  let newImageId: string
  try {
    newImageId = await db.transaction(async (tx) => {
      return createGalleryImage(tx, {
        blobUrl,
        provenance: 'ai_generated',
        userId,
        lineageId,
        writeLedger: true,
      })
    })
  } catch (err) {
    await deleteOrphanBlob(store, blobUrl)
    throw err
  }

  // Devolve a imagem-preview (deselecionada por construção — `image_id` não mudou).
  return { kind: 'ok', image: { id: newImageId, url: blobUrl, aiGenerated: true, selected: false } }
}

/**
 * Núcleo COMPARTILHADO da criação de uma imagem da galeria (#222): insere a `recipe_image` com a
 * proveniência + a `lineage_id` da Receita (ACRESCENTA à galeria; NÃO toca `image_id` nem reapa) e —
 * para `ai_generated` quando `writeLedger` — grava o EVENTO no ledger imutável (ATÔMICO com a
 * criação). O custo gasto = linha permanente: regenerar/substituir/moderar NÃO devolve o slot
 * (ADR-0017). Devolve o id da imagem criada; o CALLER decide se a aponta como face (image_id).
 */
async function createGalleryImage(
  tx: Tx,
  args: {
    blobUrl: string
    provenance: ImageProvenance
    userId: string
    lineageId: string
    writeLedger?: boolean
  },
): Promise<string> {
  const { blobUrl, provenance, userId, lineageId, writeLedger } = args
  const [created] = await tx
    .insert(recipeImage)
    .values({ blobUrl, provenance, createdBy: userId, lineageId })
    .returning({ id: recipeImage.id })

  if (writeLedger && provenance === 'ai_generated') {
    await tx.insert(imageGeneration).values({ userId })
  }

  return created.id
}

/**
 * SELECIONAR uma imagem da galeria como face pública (#222, ADR-0022 dec.1) — "Usar esta" / re-selecionar
 * uma antiga. Custo ZERO (sem ledger, sem reap): só repointa `recipe.image_id`. Leak-safe (ADR-0011):
 * UM `not_found` para TODOS de: não-dono/catálogo, imageId inexistente, e imagem de OUTRA linhagem
 * (lineage_id ≠ recipe.lineage_id) — nunca distingue, nunca 403. Reimpõe ownership na escrita.
 */
export async function applyRecipeImageSelect(input: {
  db: Database
  id: string
  userId: string
  imageId: string
  requestLocale: string
}): Promise<RecipeImageResult> {
  const { db, id, userId, imageId, requestLocale } = input

  // Gate de dono + lineage_id da Receita. Catálogo/não-dono ⇒ 404 (leak-safe).
  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  // A imagem precisa existir E pertencer à MESMA linhagem (membro da galeria desta Receita). Qualquer
  // falha (inexistente / linhagem estrangeira) ⇒ o MESMO not_found do não-dono (não vaza existência).
  const [img] = await db
    .select({ id: recipeImage.id })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, imageId), eq(recipeImage.lineageId, gate.lineageId)))
    .limit(1)
  if (!img) return { kind: 'not_found' }

  // Repointa a face (custo zero). Reimpõe ownership na escrita (defesa-em-profundidade).
  await db
    .update(recipe)
    .set({ imageId, updatedAt: new Date() })
    .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId)))

  return buildView(db, id, requestLocale, userId)
}

/**
 * APAGAR uma imagem da galeria (#222, ADR-0022 dec.1) — a ÚNICA op destrutiva. Alcance LINHAGEM-escopado
 * (a imagem deve ser membro da galeria desta Receita, senão `not_found`, leak-safe). O bloqueio é um
 * ref-count GLOBAL (ADR-0016): se ALGUMA versão ainda a referencia como face (`COUNT(recipe WHERE
 * image_id = X) > 0`) ⇒ `in_use` (409 — US26 "nenhuma versão a referencia"). Caso contrário apaga a
 * linha `recipe_image` + reapa o blob (1 linha = 1 blob ⇒ sempre órfão uma vez sem referência).
 *
 * Edge aceitável (documentado, NÃO resolvido no spine): uma regeneração same-owner carrega image_id
 * adiante (#131), então uma versão antiga pode ainda referenciar a imagem; apagá-la pela galeria da
 * versão atual devolve `in_use` até aquela versão deselecionar. O dono resolve deselecionando lá. Sem
 * cascata silenciosa cross-version (YAGNI).
 */
export async function applyRecipeGalleryImageDelete(input: {
  db: Database
  store: ImageStore
  id: string
  userId: string
  imageId: string
  requestLocale: string
}): Promise<RecipeGalleryDeleteResult> {
  const { db, store, id, userId, imageId, requestLocale } = input

  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  // Alcance: a imagem é membro da galeria desta linhagem? Senão not_found (leak-safe).
  const [img] = await db
    .select({ blobUrl: recipeImage.blobUrl })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, imageId), eq(recipeImage.lineageId, gate.lineageId)))
    .limit(1)
  if (!img) return { kind: 'not_found' }

  // Ref-count GLOBAL: ainda é a face de ALGUMA versão? ⇒ in_use (409). Numa tx para evitar corrida
  // entre o COUNT e o DELETE (uma seleção concorrente entre os dois reativaria a referência).
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
  return buildView(db, id, requestLocale, userId)
}

/**
 * `created_at` dos EVENTOS de geração do usuário na janela 24h (insumo do teto). Lê do LEDGER
 * imutável `image_generation` (NÃO de `recipe_image`): assim regenerar/substituir/moderar a imagem
 * NÃO devolve o slot — o custo já gasto conta na janela (ADR-0017).
 */
async function loadRecentAiGenAt(db: Database, userId: string, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - IMAGE_GEN_WINDOW_MS)
  const rows = await db
    .select({ createdAt: imageGeneration.createdAt })
    .from(imageGeneration)
    .where(and(eq(imageGeneration.userId, userId), gte(imageGeneration.createdAt, since)))
  return rows.map((r) => r.createdAt)
}

/**
 * REMOVER a face (DELETE /image) = DESELECIONAR (#222) — zera `recipe.image_id` (volta ao
 * placeholder), NÃO apaga nada: a imagem fica na GALERIA, re-selecionável (ADR-0022 dec.1; o reap
 * saiu de cena). Idempotente (sem face ⇒ no-op). Para APAGAR de fato uma imagem, use o gallery-delete.
 */
export async function applyRecipeImageRemoval(input: {
  db: Database
  store: ImageStore
  id: string
  userId: string
  requestLocale: string
}): Promise<RecipeImageResult> {
  const { db, id, userId, requestLocale } = input

  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  await db
    .update(recipe)
    .set({ imageId: null, updatedAt: new Date() })
    .where(and(eq(recipe.id, id), eq(recipe.ownerId, userId)))

  return buildView(db, id, requestLocale, userId)
}

/** Gate barato compartilhado: dono + lineage_id da Receita (ou null se inexistente). */
async function loadOwnerGate(
  db: Database,
  id: string,
): Promise<{ ownerId: string | null; imageId: string | null; lineageId: string } | null> {
  const [gate] = await db
    .select({ ownerId: recipe.ownerId, imageId: recipe.imageId, lineageId: recipe.lineageId })
    .from(recipe)
    .where(eq(recipe.id, id))
  return gate ?? null
}

/**
 * Carrega a GALERIA da linhagem (#222, ADR-0022 dec.1) — todas as `recipe_image` daquela `lineage_id`,
 * ordenadas por `created_at` (índice composto `recipe_image_lineage_idx`). `selected = id === image_id`.
 * Para o #222 lista TODAS (imagens moderadas inclusas — o dono vê as próprias; o visual de moderação
 * × galeria + "moderada não vira face pública" é #225, não aqui). Owner-only (carregada na borda).
 */
export async function loadGallery(
  db: Database,
  lineageId: string,
  selectedImageId: string | null,
): Promise<GalleryImage[]> {
  const rows = await db
    .select({ id: recipeImage.id, blobUrl: recipeImage.blobUrl, provenance: recipeImage.provenance })
    .from(recipeImage)
    .where(eq(recipeImage.lineageId, lineageId))
    .orderBy(asc(recipeImage.createdAt), asc(recipeImage.id))
  return rows.map((r) => ({
    id: r.id,
    url: r.blobUrl,
    aiGenerated: r.provenance === 'ai_generated',
    selected: r.id === selectedImageId,
  }))
}

/**
 * Ref-count: a imagem ANTERIOR (`oldImageId`) ficou órfã? A Receita JÁ foi repontada (para
 * `newImageId` ou NULL) ANTES desta chamada, então `COUNT(recipe WHERE image_id = old)` exclui a
 * linha atual e conta só OUTRAS versões que ainda compartilham o blob (carry-forward #131). Zero
 * refs ⇒ apaga a LINHA recipe_image e devolve o `blob_url` (pra deleção pós-commit do blob); >0 ⇒
 * mantém (outra versão ainda usa) e devolve null. No-op quando não havia imagem ou ela não mudou.
 *
 * #222: NÃO é mais chamado por generate/upload (o reap-on-swap saiu de cena — a galeria mantém todas).
 * PERMANECE para o HARD-delete da Receita (#146, owner-edit.ts): lá `newImageId=null` e a Receita já
 * foi DELETADA na mesma tx, então o COUNT exclui a linha apagada e conta só OUTRAS versões.
 */
export async function reapOrphanImage(
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
export async function deleteOrphanBlob(store: ImageStore, blobUrl: string | null): Promise<void> {
  if (!blobUrl || !store.owns(blobUrl)) return
  try {
    await store.delete(blobUrl)
  } catch {
    // Órfão tolerável: a Receita já foi repontada/limpa; não propagamos a falha de limpeza.
  }
}

/**
 * Monta a view atualizada (mesma forma do GET, viewerId = dono), COM a galeria da linhagem (#222,
 * owner — esta função só roda em caminhos do dono). `not_found` em corrida improvável.
 */
async function buildView(
  db: Database,
  id: string,
  requestLocale: string,
  userId: string,
): Promise<RecipeImageResult> {
  const rows = await loadRecipeRows(db, id)
  if (!rows) return { kind: 'not_found' }
  // `lineage_id` é NOT NULL no banco; o `?? ''` só satisfaz o tipo opcional do RecipeRow puro.
  const gallery = await loadGallery(db, rows.recipe.lineageId ?? '', rows.recipe.imageId ?? null)
  return { kind: 'ok', view: resolveRecipeView({ ...rows, requestLocale, viewerId: userId, gallery }) }
}
