import { and, asc, eq, gte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, imageGeneration, users } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'
import type { ImageGenerator } from '@/server/images/image-generator'
import { computeImageCost, type ImageUsage } from '@/domain/image-cost'
import type { GalleryImage, RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import type { ImageProvenance } from '@/domain/recipe'
import type { Role } from '@/domain/user'
import { decideImageQuota, IMAGE_GEN_WINDOW_MS } from '@/domain/image-quota'
import { capFromConfig } from '@/domain/image-gen-config'
import { buildDishImagePrompt, composeImagePrompt, composeEditImagePrompt } from '@/domain/image-prompt'
import { pgCode } from '@/server/recipe/visibility' // #285: lê o SQLSTATE p/ tratar o FK da imagem-base (23503)
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

/**
 * Resultado do SELECT (#225): inclui `moderated` (409) além do `ok`/`not_found`. Uma imagem MODERADA
 * pelo Curador (#133, flag por-imagem) NÃO pode virar a face pública ("moderada não vira face pública"
 * no seam: image_id nunca aponta p/ uma moderada). NÃO é leak-sensitive (o select é owner-only — o dono
 * é dono da imagem moderada), então um erro distinto é seguro (≠ o not_found leak-safe). União PRÓPRIA
 * (não alarga o RecipeImageResult de upload/removal — espelha o `in_use` do gallery-delete).
 */
export type RecipeImageSelectResult = RecipeImageResult | { kind: 'moderated' }

/**
 * Resultado da GERAÇÃO-como-preview (#222/#223): NÃO devolve view (a face não mudou) — só a imagem +
 * o `basePrompt` (#223: o prompt-base montado da receita, pro modal exibir read-only). O base é
 * sempre re-derivado no servidor; o cliente nunca o envia (só o refino) — invariante do #214.
 */
export type RecipeImageGenResult =
  | { kind: 'ok'; image: GalleryImage; basePrompt: string } // 200 — imagem (preview) + prompt-base read-only
  | { kind: 'not_found' } //                          404 — inexistente / não-dono / catálogo
  | { kind: 'blocked' } //                            403 — geração-por-IA BLOQUEADA p/ este usuário (#226)
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
  // #285 (image-to-image): id da imagem-base — a variante é editada a partir dela. Ausente ⇒ do zero.
  sourceImageId?: string
}): Promise<RecipeImageGenResult> {
  const { db, store, generator, id, userId, role, promptOverride, sourceImageId } = input
  const now = new Date()
  // #227 (ADR-0022 dec.3): geração COM refino (o sufixo de estilo em texto livre do Owner, #223)
  // marca a imagem `review_required` ⇒ fila PROATIVA do Curador. Refino = override não-vazio (trim).
  // Um-clique (sem override) ⇒ false. NÃO é um gate de publicação (default-open intacto, ADR-0020).
  const hasRefino = !!promptOverride?.trim()
  // #285 (ADR-0022 dec.4): TODA edição (imagem-base presente) também nasce `review_required` — o
  // Curador vê a variante na fila (e, via source_image_id, que nasceu de uma moderada, se for o caso).
  const reviewRequired = hasRefino || !!sourceImageId

  // 1. Carrega a receita (espinha + traduções + ingredientes) e prova ownership (404 leak-safe).
  //    O gate de dono vem ANTES de tocar o gerador (caro) ⇒ anon/não-dono nunca disparam o seam.
  const rows = await loadRecipeRows(db, id)
  if (!rows || rows.recipe.ownerId == null || rows.recipe.ownerId !== userId) return { kind: 'not_found' }

  // `lineage_id` é NOT NULL no banco; o `?? ''` só satisfaz o tipo opcional do RecipeRow puro.
  const lineageId = rows.recipe.lineageId ?? ''

  // #285 (image-to-image): valida a imagem-base CEDO (logo após o gate de dono) — own-gated pela
  // LINHAGEM. Leak-safe: UM `not_found` para imageId inexistente E imagem de OUTRA linhagem (nunca
  // distingue). Moderada da MESMA linhagem é PERMITIDA como fonte (ADR-0022 dec.4 / Q3=B — a variante
  // re-entra na revisão). Só o SELECT (barato) aqui; os BYTES (`store.get`, I/O) só depois dos gates
  // de cota — o invariante "não tocar I/O pago antes de autorizado/dentro-da-cota" segue valendo.
  let sourceBlobUrl: string | null = null
  if (sourceImageId) {
    const [srcRow] = await db
      .select({ blobUrl: recipeImage.blobUrl })
      .from(recipeImage)
      .where(and(eq(recipeImage.id, sourceImageId), eq(recipeImage.lineageId, lineageId)))
    if (!srcRow) return { kind: 'not_found' }
    sourceBlobUrl = srcRow.blobUrl
  }

  // 1b. Restrição GRANULAR de geração-por-IA (#226, ADR-0022 dec.3 / 1º gancho do ADR-0007): o
  //     requester (= o dono, já provado acima) está BLOQUEADO pelo Curador? ⇒ 403 ANTES do seam.
  //     Defesa-em-profundidade: a UI já esconde a ação ao bloqueado, mas o servidor é a verdade.
  //     APÓS o gate de dono (404 leak-safe): um não-dono nunca chega aqui ⇒ nunca aprende o bloqueio
  //     na receita de outrem. É por-USUÁRIO (flag em `users`), não por-receita. SELECT mínimo.
  if (await isImageGenBlocked(db, userId)) return { kind: 'blocked' }

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

  // #285: AGORA (depois dos gates de cota) lê os BYTES da imagem-base (image-to-image). Erro de rede OU
  // `get` null (blob sumiu) ⇒ 503 storage. Lido AQUI (no wrapper de DONO) e passado ao núcleo — o
  // early-validate + a leak-safety da imagem-base são owner-específicos, ficam fora do núcleo.
  let source: { data: Buffer; contentType: string } | undefined
  if (sourceBlobUrl) {
    try {
      source = (await store.get(sourceBlobUrl)) ?? undefined
    } catch {
      return { kind: 'storage' }
    }
    if (!source) return { kind: 'storage' }
  }

  // 4-7: NÚCLEO COMPARTILHADO (#238) — compõe o prompt (ancorado no prato #214) → gera → guarda →
  //       insere recipe_image + ledger numa única tx. Owner NÃO auto-seleciona (preview deselecionado
  //       #222: `image_id` intocado, a face só muda no "Usar esta"). O union do núcleo (generator/
  //       storage/not_found) é sub-tipo de RecipeImageGenResult ⇒ passa direto; só o 'ok' é remapeado.
  const core = await generateAndStoreGalleryImage({
    db,
    store,
    generator,
    recipeId: id,
    lineageId,
    actorUserId: userId,
    content: {
      titulo: rows.translations.find((t) => t.locale === rows.recipe.originalLocale)?.titulo ?? '',
      cozinha: rows.recipe.cozinha ?? null,
      categoria: rows.recipe.categoria ?? null,
      ingredientes: rows.ingredients.map((i) => i.rawText ?? '').filter((s) => s.length > 0),
    },
    model: genConfig.model,
    promptOverride,
    source,
    sourceImageId,
    reviewRequired,
    autoSelect: false,
  })
  if (core.kind !== 'ok') return core
  return { kind: 'ok', image: core.image, basePrompt: core.basePrompt }
}

/** Resultado do núcleo de geração+persistência (#238): `ok` carrega o id (pro caller selecionar/lote). */
export type GenerateGalleryResult =
  | { kind: 'ok'; imageId: string; image: GalleryImage; basePrompt: string }
  | { kind: 'generator' } //  503 — geração por IA indisponível
  | { kind: 'storage' } //    503 — ImageStore indisponível
  | { kind: 'not_found' } //  404 — TOCTOU: a imagem-base sumiu entre o validate e o insert (FK 23503)

/**
 * Núcleo COMPARTILHADO de geração+persistência de imagem da galeria (#238, ADR-0026 emenda dec.10) —
 * extraído de `applyRecipeImageGeneration` p/ reuso pelo caminho de CATÁLOGO (estúdio do curador
 * #238, auto-gen na aprovação, script de lote). Recebe a Receita JÁ AUTORIZADA (o CALLER gateia:
 * owner-gate OU `origin='catalog'`) e a fonte JÁ lida (image-to-image, só owner — o núcleo não conhece
 * o caminho de dono). Faz: compõe o prompt (SEMPRE ancorado no prato #214; o override é sufixo de
 * estilo, nunca substitui) → gera (Gemini) → guarda o blob → INSERE a `recipe_image` + ledger
 * (`createGalleryImage`, ATÔMICO) [+ SELECIONA a face se `autoSelect`] numa ÚNICA tx → limpa o blob
 * órfão se a tx falhar. `autoSelect=true` (catálogo) seta `image_id` na MESMA tx ⇒ `image_id IS NULL
 * ⟺ sem linha de ledger ⟺ retry seguro` (sem cobrança dupla — fecha o HIGH do plan-review).
 * `autoSelect=false` (owner) devolve preview DESELECIONADO (#222). Threada usage+model ao ledger
 * (custo real, nunca NULL). RETORNA union (não LANÇA nas falhas esperadas) — o caller decide.
 */
export async function generateAndStoreGalleryImage(input: {
  db: Database
  store: ImageStore
  generator: ImageGenerator
  recipeId: string // já validado/autorizado pelo caller
  lineageId: string
  actorUserId: string // `created_by` da imagem + `user_id` do ledger (dono OU curador)
  content: { titulo: string; cozinha: string | null; categoria: string | null; ingredientes: string[] }
  model: string // genConfig.model (o que de fato foi pedido)
  promptOverride?: string
  source?: { data: Buffer; contentType: string } // image-to-image, JÁ lida (só owner)
  sourceImageId?: string
  reviewRequired: boolean
  autoSelect: boolean // catálogo true (seta a face), owner false (preview)
}): Promise<GenerateGalleryResult> {
  const {
    db,
    store,
    generator,
    recipeId,
    lineageId,
    actorUserId,
    content,
    model,
    promptOverride,
    source,
    sourceImageId,
    reviewRequired,
    autoSelect,
  } = input

  const base = buildDishImagePrompt({
    titulo: content.titulo,
    cozinha: content.cozinha,
    categoria: content.categoria,
    ingredientes: content.ingredientes,
  })
  // #285: edição (imagem-base presente) usa o template de EDIÇÃO (ainda ancorado no prato). Do zero ⇒ geração.
  const prompt = sourceImageId
    ? composeEditImagePrompt(base, promptOverride)
    : composeImagePrompt(base, promptOverride)

  let generated
  try {
    generated = await generator.generateDishImage({ prompt, model, source })
  } catch {
    return { kind: 'generator' }
  }

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

  let newImageId: string
  try {
    newImageId = await db.transaction(async (tx) => {
      const imageId = await createGalleryImage(tx, {
        blobUrl,
        provenance: 'ai_generated',
        userId: actorUserId,
        lineageId,
        writeLedger: true,
        reviewRequired,
        // #224: custo real no ledger (usage+model). Ausente ⇒ NULL honesto. NUNCA esquecer (senão R$ invisível).
        usage: generated.usageMetadata,
        model: generated.model ?? model,
        sourceImageId,
      })
      // #238 (H4): catálogo AUTO-SELECIONA na MESMA tx (insert+ledger+face atômicos ⇒ retry seguro, sem
      // cobrança dupla). Owner NÃO seleciona (preview #222). NÃO reapa (a galeria mantém tudo).
      if (autoSelect) {
        await tx.update(recipe).set({ imageId, updatedAt: new Date() }).where(eq(recipe.id, recipeId))
      }
      return imageId
    })
  } catch (err) {
    await deleteOrphanBlob(store, blobUrl)
    // #285: TOCTOU — a imagem-base sumiu entre o SELECT e o INSERT ⇒ FK 23503 ⇒ 404 (não 500 cru).
    if (sourceImageId && pgCode(err) === '23503') return { kind: 'not_found' }
    throw err
  }

  return {
    kind: 'ok',
    imageId: newImageId,
    image: {
      id: newImageId,
      url: blobUrl,
      aiGenerated: true,
      selected: autoSelect,
      moderated: false,
      editedFromId: sourceImageId ?? null,
    },
    basePrompt: base,
  }
}

/**
 * Núcleo COMPARTILHADO da criação de uma imagem da galeria (#222): insere a `recipe_image` com a
 * proveniência + a `lineage_id` da Receita (ACRESCENTA à galeria; NÃO toca `image_id` nem reapa) e —
 * para `ai_generated` quando `writeLedger` — grava o EVENTO no ledger imutável (ATÔMICO com a
 * criação). O custo gasto = linha permanente: regenerar/substituir/moderar NÃO devolve o slot
 * (ADR-0017). Devolve o id da imagem criada; o CALLER decide se a aponta como face (image_id).
 *
 * #224 (ADR-0022 dec.4): a linha do ledger CARREGA o custo — o `model` + os tokens (`usage`) + o
 * `cost_usd` SNAPSHOT (`computeImageCost`). TUDO best-effort: `usage` ausente (telemetria indisponível)
 * ⇒ tokens/custo NULOS, a linha ainda é gravada (o teto conta por contagem, #167). `cost_usd` numeric
 * ⇒ string no insert. Re-selecionar/enviar não passam por aqui com `writeLedger` ⇒ não geram linha.
 */
async function createGalleryImage(
  tx: Tx,
  args: {
    blobUrl: string
    provenance: ImageProvenance
    userId: string
    lineageId: string
    writeLedger?: boolean
    usage?: ImageUsage
    model?: string
    // #227: marca a imagem `review_required` (fila proativa do Curador). Só `ai_generated` COM refino
    // passa `true`; upload e geração-um-clique omitem ⇒ `false`. NÃO gateia publicação (ADR-0020).
    reviewRequired?: boolean
    // #285: parentesco de edição (image-to-image) — a imagem-base de que esta variante foi editada.
    // Ausente/undefined ⇒ gerada do zero / upload (source_image_id null).
    sourceImageId?: string
  },
): Promise<string> {
  const { blobUrl, provenance, userId, lineageId, writeLedger, usage, model, reviewRequired } = args
  const [created] = await tx
    .insert(recipeImage)
    .values({
      blobUrl,
      provenance,
      createdBy: userId,
      lineageId,
      reviewRequired: reviewRequired ?? false,
      sourceImageId: args.sourceImageId ?? null,
    })
    .returning({ id: recipeImage.id })

  if (writeLedger && provenance === 'ai_generated') {
    // Custo SNAPSHOT da tabela de preço EM CÓDIGO (puro). usage/modelo ausentes ⇒ null (honesto).
    const costUsd = model != null ? computeImageCost(usage, model) : null
    await tx.insert(imageGeneration).values({
      userId,
      model: model ?? null,
      promptTokens: usage?.promptTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      thinkingTokens: usage?.thinkingTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      // numeric → string|null no insert (precisão exata; espelha recipe_ingredient.quantidade).
      costUsd: costUsd != null ? costUsd.toString() : null,
    })
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
}): Promise<RecipeImageSelectResult> {
  const { db, id, userId, imageId, requestLocale } = input

  // Gate de dono + lineage_id da Receita. Catálogo/não-dono ⇒ 404 (leak-safe).
  const gate = await loadOwnerGate(db, id)
  if (!gate || gate.ownerId == null || gate.ownerId !== userId) return { kind: 'not_found' }

  // A imagem precisa existir E pertencer à MESMA linhagem (membro da galeria desta Receita). Qualquer
  // falha (inexistente / linhagem estrangeira) ⇒ o MESMO not_found do não-dono (não vaza existência).
  const [img] = await db
    .select({ id: recipeImage.id, moderatedAt: recipeImage.moderatedAt })
    .from(recipeImage)
    .where(and(eq(recipeImage.id, imageId), eq(recipeImage.lineageId, gate.lineageId)))
    .limit(1)
  if (!img) return { kind: 'not_found' }

  // #225: imagem MODERADA (#133) NÃO vira face pública — bloqueia o select no seam (image_id nunca
  // aponta p/ uma moderada). Distinto do not_found: o select é owner-only e o dono é dono da imagem
  // moderada, então não vaza existência (≠ leak-safe). 409 imagem_moderada na borda.
  if (img.moderatedAt != null) return { kind: 'moderated' }

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
 * Restrição GRANULAR de geração-por-IA (#226, ADR-0022 dec.3): o Usuário foi BLOQUEADO pelo Curador?
 * Lê só `image_gen_blocked_at` em `users` (bloqueado = `≠ null`). SELECT mínimo, usado no caminho de
 * geração (defesa-em-profundidade APÓS o gate de dono) e na montagem da view do dono (afordância
 * proativa). É por-USUÁRIO, não por-receita.
 */
async function isImageGenBlocked(db: Database, userId: string): Promise<boolean> {
  const [u] = await db
    .select({ blockedAt: users.imageGenBlockedAt })
    .from(users)
    .where(eq(users.id, userId))
  return u?.blockedAt != null
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
 * Lista TODAS (imagens moderadas inclusas — o dono vê as próprias). #225: `moderated = moderated_at ≠ null`
 * (flag por-imagem do #133), pro thumbnail marcá-la "removida" e desabilitar o select (e o nudge da face
 * moderada). Owner-only (carregada na borda); a galeria nunca vaza no caminho público.
 */
export async function loadGallery(
  db: Database,
  lineageId: string,
  selectedImageId: string | null,
): Promise<GalleryImage[]> {
  const rows = await db
    .select({
      id: recipeImage.id,
      blobUrl: recipeImage.blobUrl,
      provenance: recipeImage.provenance,
      moderatedAt: recipeImage.moderatedAt,
      sourceImageId: recipeImage.sourceImageId,
    })
    .from(recipeImage)
    .where(eq(recipeImage.lineageId, lineageId))
    .orderBy(asc(recipeImage.createdAt), asc(recipeImage.id))
  return rows.map((r) => ({
    id: r.id,
    url: r.blobUrl,
    aiGenerated: r.provenance === 'ai_generated',
    selected: r.id === selectedImageId,
    moderated: r.moderatedAt != null,
    // #285: parentesco de edição (image-to-image) ⇒ dirige o selo "Editada com IA" no estúdio do Owner.
    editedFromId: r.sourceImageId ?? null,
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
  // #226: a view do dono carrega o flag de bloqueio (owner-gated) pra consistência pós-ação — a UI
  // esconde "Gerar com IA" se o Curador bloqueou. userId aqui é sempre o dono (esta fn só roda em
  // caminhos do dono); a flag é por-USUÁRIO, então é o bloqueio do próprio requester=dono.
  const imageGenBlocked = await isImageGenBlocked(db, userId)
  return {
    kind: 'ok',
    view: resolveRecipeView({ ...rows, requestLocale, viewerId: userId, gallery, imageGenBlocked }),
  }
}
