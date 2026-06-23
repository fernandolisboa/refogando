import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  recipe,
  recipeImage,
  recipeTranslation,
  recipeIngredient,
  recipeTag,
  tag,
  ingredient,
  recipeVote,
  recipeFavorite,
  users,
} from '@/db/schema'
import type { RecipeAuthor, RecipeRow, TranslationRow, IngredientItem } from '@/domain/recipe-read'
import { eligibleForPublicRead } from '@/domain/recipe-detail-route'

/**
 * Loader de servidor compartilhado da Receita (issue #8, §7b — refactor DRY com #3).
 *
 * Carrega a espinha + traduções + ingredientes + tags de UMA Receita pelo id e
 * devolve as linhas no formato que o módulo PURO `resolveRecipeView` consome
 * (`RecipeRow` / `TranslationRow[]` / `IngredientItem[]` / `string[]`). NÃO monta
 * a view (isso é puro, fica em `recipe-read.ts`) e NÃO valida o formato do id
 * (o chamador faz o guard de uuid). Retorna `null` quando a Receita não existe.
 *
 * Extraído do load inline que vivia em `recipes/[id]/route.ts`: AMBAS a rota da #3
 * e a rota de retomada (`creation-sessions/[id]`) chamam este loader.
 */
export type LoadedRecipeRows = {
  recipe: RecipeRow
  translations: TranslationRow[]
  ingredients: IngredientItem[]
  tags: string[]
  /**
   * Autoria (#129) — `name` + `handle` PÚBLICOS do dono, carregados via SELECT em `users`
   * sobre `recipe.owner_id`. `undefined` para Catálogo/sistema (`owner_id` NULL — sem dono
   * humano) ⇒ a vista não exibe byline. PÚBLICO (não owner-gated): o crédito "por <name>"
   * aparece para qualquer leitor. NUNCA expõe o `owner_id`/`id` interno.
   */
  author?: RecipeAuthor
  /**
   * Imagem da receita (#130, ADR-0016) — `blob_url` PÚBLICO da `recipe_image` apontada por
   * `recipe.image_id` (FK opcional). `undefined` ("ausente ≠ vazio") quando a Receita não tem
   * imagem (o caso normal). PÚBLICO (não owner-gated): a foto do prato aparece para qualquer leitor
   * que vê a Receita. NUNCA expõe o `image_id` interno — só a URL servível.
   */
  imageUrl?: string
  /**
   * Imagem gerada por IA? (#132) — `true` quando a `recipe_image` apontada tem
   * `provenance = 'ai_generated'`. Dirige o selo "✨ gerada por IA" no público (honestidade,
   * ADR-0017). AUSENTE quando não há imagem ou é foto do usuário (sem selo).
   */
  imageAiGenerated?: boolean
  /**
   * Imagem MODERADA pelo Curador (#133, ADR-0016) — `true` quando a `recipe_image` apontada tem
   * `moderated_at` não-NULL. AUSENTE quando não há imagem ou ela não foi moderada (o caso normal).
   * O loader SEMPRE traz `blob_url`/`provenance` (não filtra a query por moderação): é o módulo
   * PURO `resolveRecipeView` que ESCONDE `imageUrl`/`imageAiGenerated` do público (não-dono) quando
   * moderada — o Owner (`canManage`) ainda vê a própria. Espelha o gate de pool do feed/busca (que
   * filtram com `AND moderated_at IS NULL`), mas aqui mantemos o dado carregado para o Owner.
   */
  imageModerated?: boolean
}

export async function loadRecipeRows(db: Database, id: string): Promise<LoadedRecipeRows | null> {
  const [row] = await db.select().from(recipe).where(eq(recipe.id, id))
  if (!row) return null

  // As leituras seguintes são independentes entre si: em paralelo. A Autoria (#129) só é buscada
  // quando há dono humano (`owner_id` não-NULL); a Imagem (#130) só quando há `image_id` (FK) —
  // ambas dispensam a query no caso comum (Catálogo sem autor / Receita sem foto).
  const [translations, ingredients, tags, authorRows, imageRows] = await Promise.all([
    db.select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id)),
    db
      .select({
        ordem: recipeIngredient.ordem,
        quantidade: recipeIngredient.quantidade,
        unidade: recipeIngredient.unidade,
        rawText: recipeIngredient.rawText,
        // alérgenos vêm da tabela PAI via LEFT JOIN — null quando a FK é nula
        // (item raw-text-only) ou quando o ingredient casado não tem dado de
        // alérgeno. N:1 por FK única (ingredient.id PK), então não infla linhas.
        alergenos: ingredient.alergenos,
      })
      .from(recipeIngredient)
      .leftJoin(ingredient, eq(recipeIngredient.ingredientId, ingredient.id))
      .where(eq(recipeIngredient.recipeId, id))
      .orderBy(recipeIngredient.ordem, recipeIngredient.id),
    db
      .select({ nome: tag.nome })
      .from(recipeTag)
      .innerJoin(tag, eq(recipeTag.tagId, tag.id))
      .where(eq(recipeTag.recipeId, id))
      .orderBy(tag.nome),
    // Autoria (#129): só `name`+`handle` PÚBLICOS. `owner_id` NULL ⇒ predicado nunca casa ⇒
    // zero linhas ⇒ author undefined (Catálogo/sistema sem byline). Sem dono não há query útil,
    // mas o `eq(users.id, null)` é seguro (NULL = NULL é UNKNOWN ⇒ zero linhas).
    row.ownerId == null
      ? Promise.resolve([])
      : db
          .select({ name: users.name, handle: users.handle })
          .from(users)
          .where(eq(users.id, row.ownerId))
          .limit(1),
    // Imagem (#130): a foto do prato via recipe.image_id → recipe_image.blob_url. image_id NULL ⇒
    // sem query (Receita sem imagem, caso comum) ⇒ imageUrl undefined ("ausente ≠ vazio").
    row.imageId == null
      ? Promise.resolve([])
      : db
          .select({
            blobUrl: recipeImage.blobUrl,
            provenance: recipeImage.provenance,
            // #133: o estado de moderação acompanha blob/proveniência. SEMPRE carregado (não filtra
            // a query) — quem decide esconder do público é o módulo PURO (recipe-read), preservando
            // a visão do Owner. Espelha o `AND moderated_at IS NULL` do feed/busca, mas sem perder o dado.
            moderatedAt: recipeImage.moderatedAt,
          })
          .from(recipeImage)
          .where(eq(recipeImage.id, row.imageId))
          .limit(1),
  ])

  const authorRow = authorRows[0]
  const author: RecipeAuthor | undefined =
    authorRow != null ? { name: authorRow.name, handle: authorRow.handle } : undefined

  const imageUrl = imageRows[0]?.blobUrl ?? undefined
  const imageAiGenerated = imageRows[0]?.provenance === 'ai_generated'
  const imageModerated = imageRows[0]?.moderatedAt != null

  return {
    recipe: row,
    translations,
    ingredients,
    tags: tags.map((t) => t.nome),
    ...(author ? { author } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageAiGenerated ? { imageAiGenerated } : {}),
    // #133: repassa a flag de moderação ao PURO (que esconde a imagem do não-dono). "ausente ≠ vazio".
    ...(imageModerated ? { imageModerated } : {}),
  }
}

/**
 * Loader FOCADO do write-path de tradução (issue #23, perf): o `ensureTranslation` só
 * precisa de `recipe.originalLocale` + as linhas de `recipe_translation` daquele recipe
 * — NÃO dos ingredientes (LEFT JOIN) nem das tags (JOIN) que `loadRecipeRows` carrega
 * para montar a view. Mesma semântica de existência: Receita inexistente ⇒ `null`.
 */
export type RecipeTranslationContext = {
  originalLocale: string
  translations: TranslationRow[]
}

export async function loadRecipeTranslationContext(
  db: Database,
  id: string,
): Promise<RecipeTranslationContext | null> {
  const [row] = await db
    .select({ originalLocale: recipe.originalLocale })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!row) return null

  const translations = await db
    .select()
    .from(recipeTranslation)
    .where(eq(recipeTranslation.recipeId, id))

  return { originalLocale: row.originalLocale, translations }
}

/**
 * Estado SOCIAL leak-safe da Receita (#16): o agregado público `voteCount` e o estado do
 * PRÓPRIO viewer (`viewerVoted`/`viewerFavorited`). O chamador (GET route) decide O QUE
 * pedir conforme o gate de leitura:
 *  - `includeVoteCount`: só quando a Receita está no POOL (isPublicRead). Em owned-private
 *    NÃO pedir (o agregado não é conteúdo de pool) ⇒ `voteCount: undefined`.
 *  - `viewerId`: quando presente, carrega `viewerVoted`/`viewerFavorited` (EXISTS por
 *    (userId, id) nas duas tabelas). Ausente ⇒ ambos `undefined` (anônimo).
 *
 * As leituras pedidas são independentes ⇒ disparadas em paralelo. Retorna só o que foi
 * pedido (campos não pedidos ficam `undefined`).
 */
export type SocialState = {
  voteCount?: number
  viewerVoted?: boolean
  viewerFavorited?: boolean
}

export async function loadSocialState(
  db: Database,
  input: { id: string; viewerId?: string; includeVoteCount: boolean },
): Promise<SocialState> {
  const { id, viewerId, includeVoteCount } = input

  const tasks: Array<Promise<void>> = []
  const out: SocialState = {}

  if (includeVoteCount) {
    tasks.push(
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipeVote)
        .where(eq(recipeVote.recipeId, id))
        .then(([r]) => {
          out.voteCount = r?.count ?? 0
        }),
    )
  }

  if (viewerId != null) {
    tasks.push(
      db
        .select({ one: sql<number>`1` })
        .from(recipeVote)
        .where(and(eq(recipeVote.userId, viewerId), eq(recipeVote.recipeId, id)))
        .limit(1)
        .then((rows) => {
          out.viewerVoted = rows.length > 0
        }),
      db
        .select({ one: sql<number>`1` })
        .from(recipeFavorite)
        .where(and(eq(recipeFavorite.userId, viewerId), eq(recipeFavorite.recipeId, id)))
        .limit(1)
        .then((rows) => {
          out.viewerFavorited = rows.length > 0
        }),
    )
  }

  await Promise.all(tasks)
  return out
}

/**
 * Resolve o SLUG de uma Receita por (uuid, locale), SEM aplicar o gate de leitura pública.
 *
 * Casa a tradução do `locale` daquele `recipeId` e devolve seu `slug` (ou `null` quando a
 * Receita não existe, não tem tradução NAQUELE locale, ou a tradução ainda não ganhou slug —
 * coluna nullable durante o backfill). NÃO lê cookie/sessão. Útil onde a visibilidade não
 * importa (ex.: o LocaleSwitcher do dono montando a URL irmã da própria receita). NÃO usar para
 * o 301 anônimo do link legado — esse precisa do gate (`resolvePublicSlugForLocale`), senão
 * vaza a existência + o slug derivado do título de uma Receita PRIVADA.
 */
export async function resolveSlugForLocale(
  db: Database,
  recipeId: string,
  locale: string,
): Promise<string | null> {
  const [row] = await db
    .select({ slug: recipeTranslation.slug })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
    .limit(1)
  return row?.slug ?? null
}

/**
 * Resolve o UUID interno de uma Receita por (locale, slug) SEM aplicar o gate público — usado SÓ
 * no caminho do DONO da página de detalhe (caminho 2), onde a Receita pode ser privada e o link
 * interno do dono já usa o slug. Devolve o `recipeId` (chave da API de dados) ou `null` quando não
 * há tradução com aquele (locale, slug). NÃO lê cookie/sessão (o gate de ownership é da rota de API
 * que o caller bate em seguida). NÃO usar no caminho público (esse passa pelo gate via
 * `loadPublicRecipeBySlug`).
 */
export async function resolveRecipeIdBySlug(
  db: Database,
  slug: string,
  locale: string,
): Promise<string | null> {
  const [row] = await db
    .select({ recipeId: recipeTranslation.recipeId })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.locale, locale), eq(recipeTranslation.slug, slug)))
    .limit(1)
  return row?.recipeId ?? null
}

/**
 * Resolve o slug PÚBLICO de uma Receita por (uuid, locale) — para o **301** ANÔNIMO do link
 * legado `/{locale}/recipes/<uuid>` → `/{locale}/recipes/<slug>` (#230, ADR-0020 decisão 4),
 * emitido no proxy. APLICA o gate de leitura pública (= gate de indexação): devolve o slug SÓ
 * quando a Receita é leitura pública (comunidade/Catálogo E não-`playful` E não-removida) E tem
 * slug naquele locale; senão `null`.
 *
 * Gatear aqui é LEAK-SAFE e por design: um anônimo pedindo o UUID de uma Receita PRIVADA/playful/
 * removida NÃO recebe um 301 que revele o slug (derivado do título) nem a existência — o proxy,
 * ao receber `null`, deixa a requisição seguir para a página, que cai no caminho do DONO (cookie,
 * 404 leak-safe a quem não é dono). Assim o 301 público e o caminho do dono concordam com o gate
 * do GET por uuid. NÃO lê cookie/sessão.
 */
export async function resolvePublicSlugForLocale(
  db: Database,
  recipeId: string,
  locale: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      slug: recipeTranslation.slug,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
    })
    .from(recipeTranslation)
    .innerJoin(recipe, eq(recipeTranslation.recipeId, recipe.id))
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
    .limit(1)
  if (!row || row.slug == null) return null
  if (
    !eligibleForPublicRead({
      ownerId: row.ownerId,
      visibility: row.visibility,
      resultKind: row.resultKind,
      moderationRemovedAt: row.moderationRemovedAt,
    })
  ) {
    return null
  }
  return row.slug
}

/**
 * Leitura PÚBLICA da Receita por (locale, slug) — anônima, cacheável, via DB DIRETO (#230,
 * ADR-0020). É o seam da página de detalhe INDEXÁVEL: NÃO lê cookie/sessão, NÃO faz self-fetch
 * da API com `no-store`, NÃO força render dinâmico, NÃO personaliza para o crawler. O caminho do
 * DONO (privado/dinâmico, com cookie) é SEPARADO e não passa por aqui.
 *
 * Passo a passo:
 *  1. casa o `(locale, slug)` em `recipe_translation` (índice parcial `recipe_translation_locale_slug_uq`)
 *     para achar o `recipeId`. Sem casamento ⇒ `null` (404 leak-safe).
 *  2. lê a espinha (visibility/result_kind/moderation_removed_at) e aplica o gate de leitura
 *     PÚBLICA = gate de indexação default-open (`eligibleForPublicRead`): pública E não-`playful`
 *     E não-removida. Reprovou ⇒ `null` (privada/playful/removida não é leitura pública).
 *  3. aprovou ⇒ delega a `loadRecipeRows` para montar o MESMO shape que o resto da app consome
 *     (traduções + ingredientes + tags + autoria + imagem). Reusa o loader existente — sem
 *     duplicar a leitura nem o contrato.
 *
 * Devolve `null` para "não encontrado OU não público" (indistinguíveis na superfície pública —
 * mesma postura leak-safe do GET por uuid). O caller (page) faz `notFound()` nesse caso.
 */
export async function loadPublicRecipeBySlug(
  db: Database,
  slug: string,
  locale: string,
): Promise<LoadedRecipeRows | null> {
  // 1. (locale, slug) → recipeId. Junta translation→recipe e já traz o gate barato numa query.
  const [gate] = await db
    .select({
      recipeId: recipe.id,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
    })
    .from(recipeTranslation)
    .innerJoin(recipe, eq(recipeTranslation.recipeId, recipe.id))
    .where(and(eq(recipeTranslation.locale, locale), eq(recipeTranslation.slug, slug)))
    .limit(1)
  if (!gate) return null

  // 2. Gate de leitura PÚBLICA = gate de indexação (ADR-0020 decisão 6). Reprovou ⇒ não é
  //    leitura pública (privada-não-catálogo/playful/removida): `null` leak-safe (o dono lê pelo
  //    caminho dinâmico-com-cookie, não por aqui). O eixo de comunidade (owner-NULL = Catálogo)
  //    casa o GET por uuid, então slug e uuid concordam sobre o que é público.
  if (
    !eligibleForPublicRead({
      ownerId: gate.ownerId,
      visibility: gate.visibility,
      resultKind: gate.resultKind,
      moderationRemovedAt: gate.moderationRemovedAt,
    })
  ) {
    return null
  }

  // 3. Aprovado ⇒ monta o shape canônico via o loader existente (DRY com o GET por uuid).
  return loadRecipeRows(db, gate.recipeId)
}
