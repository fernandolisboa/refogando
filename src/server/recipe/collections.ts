import { and, eq, ne, isNull, desc, asc, inArray, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  collection,
  collectionItem,
  recipe,
  recipeSave,
  recipeImage,
  recipeTranslation,
} from '@/db/schema'
import type { LineageKind, Origin, ResultKind, Visibility, ImageProvenance } from '@/domain/recipe'
import { validateCollectionName, MAX_COLLECTIONS_PER_USER } from '@/domain/collection'
import { pgCode } from '@/server/recipe/visibility'
import { viewerReadableSqlFragment } from '@/server/recipe/visibility-sql'
import { resolveRecipeListItem, type RecipeListItem } from '@/domain/recipe-list-read'
import type { TranslationRow } from '@/domain/recipe-read'

/**
 * Núcleo com efeito das Coleções (issue #364, ADR-0027) — a camada de PASTAS PRIVADAS M:N sobre o
 * Salvar (#362). Espelha o estilo de `social.ts`/`visibility.ts`: cada operação devolve uma
 * discriminated union que a rota mapeia para HTTP (rotas finas e DRY). `db: Database` por parâmetro.
 *
 * PRIVACIDADE (inegociável): NENHUMA leitura é anônima. Toda função escopa por `collection.user_id
 * = userId`; "não é sua" e "não existe" colapsam no MESMO `not_found` (404 leak-safe, como save/GET).
 *
 * SAVE É A FONTE DA VERDADE: `collection_item ⊆ saves`. `applyCollectionAddItem` só admite Receita
 * JÁ salva (trava a save row FOR UPDATE contra a corrida com o unsave); e `applyUnsave`
 * (social.ts) apaga os `collection_item` daquele (user, recipe) na MESMA transação do DELETE do save.
 *
 * READ-PATH GATEADO (C1): os saves PERSISTEM, mas a LEITURA filtra por visibilidade — uma Receita
 * pública de 3º que o dono tornou privada / o Curador removeu do pool SOME da lista (CONTEXT
 * "Moderação reativa"), reaparecendo se voltar a ficar visível. O gate é o MESMO da Busca/Feed
 * (`viewerReadableSqlFragment` + as 3 guardas de pool), byte-a-byte igual a `eligibleToSaveByViewer`.
 */

// ── Tipos de retorno (discriminated unions mapeadas a HTTP pelas rotas) ──────────

export type CollectionSummary = { id: string; name: string; createdAt: string; itemCount: number }

export type CollectionCreateResult =
  | { kind: 'ok'; collection: { id: string; name: string; createdAt: string } }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'limit_reached' }

export type CollectionRenameResult =
  | { kind: 'ok' }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'not_found' }

export type CollectionDeleteResult = { kind: 'ok' } | { kind: 'not_found' }

export type CollectionAddItemResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'not_saved' }

export type CollectionRemoveItemResult = { kind: 'ok' } | { kind: 'not_found' }

export type CollectionItemsResult =
  | { kind: 'ok'; recipes: RecipeListItem[] }
  | { kind: 'not_found' }

export type RecipeCollectionMembership = {
  saved: boolean
  collections: { id: string; name: string; contains: boolean }[]
}

// ── CRUD de Coleção ──────────────────────────────────────────────────────────────

/**
 * Cria uma Coleção. Valida o nome (invalid_name); impõe o cap por usuário (limit_reached);
 * o INSERT com `onConflictDoNothing` no alvo (user_id, name) devolve vazio ⇒ duplicate_name
 * (idempotente contra corrida — a UNIQUE é a rede final).
 */
export async function applyCollectionCreate(input: {
  db: Database
  userId: string
  name: string
}): Promise<CollectionCreateResult> {
  const { db, userId, name } = input

  const v = validateCollectionName(name)
  if (!v.ok) return { kind: 'invalid_name' }

  // Cap por usuário (anti-abuso barato): conta antes de inserir. Corrida no limite é aceitável
  // (o cap é folgado; não há invariante crítica), e a UNIQUE cobre a de nome.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(collection)
    .where(eq(collection.userId, userId))
  if (n >= MAX_COLLECTIONS_PER_USER) return { kind: 'limit_reached' }

  const [row] = await db
    .insert(collection)
    .values({ userId, name: v.name })
    .onConflictDoNothing({ target: [collection.userId, collection.name] })
    .returning({ id: collection.id, name: collection.name, createdAt: collection.createdAt })
  if (!row) return { kind: 'duplicate_name' }

  return {
    kind: 'ok',
    collection: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() },
  }
}

/**
 * Renomeia uma Coleção do próprio usuário. Valida o nome antes; UPDATE escopado por
 * (id, user_id) — vazio ⇒ not_found (leak-safe: não é sua / não existe). Renomear pro
 * PRÓPRIO nome atual é ok (sem self-conflito). Duplicado colide na UNIQUE (23505) ⇒
 * duplicate_name (onConflictDoNothing NÃO vale em UPDATE — daí o try/catch, C4).
 */
export async function applyCollectionRename(input: {
  db: Database
  userId: string
  collectionId: string
  name: string
}): Promise<CollectionRenameResult> {
  const { db, userId, collectionId, name } = input

  const v = validateCollectionName(name)
  if (!v.ok) return { kind: 'invalid_name' }

  try {
    const [row] = await db
      .update(collection)
      .set({ name: v.name })
      .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
      .returning({ id: collection.id })
    if (!row) return { kind: 'not_found' }
    return { kind: 'ok' }
  } catch (e) {
    if (pgCode(e) === '23505') return { kind: 'duplicate_name' }
    throw e
  }
}

/**
 * Apaga uma Coleção do próprio usuário. DELETE escopado por (id, user_id) — vazio ⇒ not_found.
 * A FK ON DELETE cascade apaga os `collection_item`; os `recipe_save` PERMANECEM (apagar a pasta
 * não dessalva — remover-de-coleção ≠ dessalvar).
 */
export async function applyCollectionDelete(input: {
  db: Database
  userId: string
  collectionId: string
}): Promise<CollectionDeleteResult> {
  const { db, userId, collectionId } = input

  const [row] = await db
    .delete(collection)
    .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
    .returning({ id: collection.id })
  if (!row) return { kind: 'not_found' }
  return { kind: 'ok' }
}

/**
 * Adiciona uma Receita SALVA a uma Coleção (C5). Transação com FOR UPDATE na save row para
 * serializar contra o DELETE do unsave (mantém a invariante collection_item ⊆ saves sob corrida):
 *  1. a coleção é do user? senão not_found.
 *  2. a Receita está salva pelo user? (save row travada) senão not_saved.
 *  3. INSERT idempotente (onConflictDoNothing na PK composta — adicionar 2× = 1 linha).
 */
export async function applyCollectionAddItem(input: {
  db: Database
  userId: string
  collectionId: string
  recipeId: string
}): Promise<CollectionAddItemResult> {
  const { db, userId, collectionId, recipeId } = input

  return db.transaction(async (tx) => {
    const [own] = await tx
      .select({ id: collection.id })
      .from(collection)
      .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
    if (!own) return { kind: 'not_found' as const }

    const [savedRow] = await tx
      .select({ one: sql`1` })
      .from(recipeSave)
      .where(and(eq(recipeSave.userId, userId), eq(recipeSave.recipeId, recipeId)))
      .for('update')
    if (!savedRow) return { kind: 'not_saved' as const }

    await tx.insert(collectionItem).values({ collectionId, recipeId }).onConflictDoNothing()
    return { kind: 'ok' as const }
  })
}

/**
 * Remove uma Receita de uma Coleção do próprio usuário (idempotente; NÃO dessalva — o save é
 * a fonte da verdade). Ownership por (id, user_id) — senão not_found. O DELETE é no-op se a
 * aresta não existe.
 */
export async function applyCollectionRemoveItem(input: {
  db: Database
  userId: string
  collectionId: string
  recipeId: string
}): Promise<CollectionRemoveItemResult> {
  const { db, userId, collectionId, recipeId } = input

  const [own] = await db
    .select({ id: collection.id })
    .from(collection)
    .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
  if (!own) return { kind: 'not_found' }

  await db
    .delete(collectionItem)
    .where(and(eq(collectionItem.collectionId, collectionId), eq(collectionItem.recipeId, recipeId)))
  return { kind: 'ok' }
}

// ── Leitores ─────────────────────────────────────────────────────────────────────

/**
 * Lista as Coleções do usuário com a contagem de itens. LEFT JOIN + COUNT(recipe_id) (C9: NÃO
 * `count(*)` — a coleção vazia dá 1 linha all-NULL e `count(*)` daria 1 errado; `count(recipe_id)`
 * conta NULLs como 0). Ordena por nome. `itemCount` conta a aresta CRUA (sem gate de visibilidade —
 * é só o tamanho da pasta; a leitura dos ITENS é que gateia).
 */
export async function loadCollections(input: {
  db: Database
  userId: string
}): Promise<CollectionSummary[]> {
  const { db, userId } = input
  const rows = await db
    .select({
      id: collection.id,
      name: collection.name,
      createdAt: collection.createdAt,
      itemCount: sql<number>`count(${collectionItem.recipeId})::int`,
    })
    .from(collection)
    .leftJoin(collectionItem, eq(collectionItem.collectionId, collection.id))
    .where(eq(collection.userId, userId))
    .groupBy(collection.id)
    .orderBy(asc(collection.name))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    itemCount: r.itemCount,
  }))
}

/**
 * Membership do detalhe (C10): para uma Receita, devolve `saved` (EXISTS recipe_save do user) +
 * TODAS as coleções do user, cada uma com `contains` (esta Receita está nela?). Query única sem
 * N+1 (LEFT JOIN condicional em recipe_id). Retorna as coleções do PRÓPRIO user mesmo que a
 * Receita não exista/não seja salva (o picker precisa listar as pastas pra adicionar) — zero leak.
 */
export async function loadRecipeCollectionMembership(input: {
  db: Database
  userId: string
  recipeId: string
}): Promise<RecipeCollectionMembership> {
  const { db, userId, recipeId } = input

  const collections = await db
    .select({
      id: collection.id,
      name: collection.name,
      contains: sql<boolean>`(${collectionItem.recipeId} is not null)`,
    })
    .from(collection)
    .leftJoin(
      collectionItem,
      and(eq(collectionItem.collectionId, collection.id), eq(collectionItem.recipeId, recipeId)),
    )
    .where(eq(collection.userId, userId))
    .orderBy(asc(collection.name))

  const [savedRow] = await db
    .select({ one: sql`1` })
    .from(recipeSave)
    .where(and(eq(recipeSave.userId, userId), eq(recipeSave.recipeId, recipeId)))

  return { saved: !!savedRow, collections }
}

/**
 * "Todos": TODAS as Receitas salvas pelo user, gateadas por visibilidade (C1), mais recentes
 * primeiro (`recipe_save.created_at DESC`). Espelha `listMyRecipes` EXATO no split de DUAS QUERIES
 * (C2): query-1 = saves ⋈ recipe + thumbnail; query-2 = traduções `IN (...)`.
 */
export async function loadSavedRecipes(input: {
  db: Database
  userId: string
  requestLocale: string
  fallbackName: string
}): Promise<RecipeListItem[]> {
  const { db, userId, requestLocale, fallbackName } = input

  const rows = await db
    .select(RECIPE_LIST_COLS)
    .from(recipeSave)
    .innerJoin(recipe, eq(recipeSave.recipeId, recipe.id))
    .leftJoin(recipeImage, and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)))
    .where(
      and(
        eq(recipeSave.userId, userId),
        viewerReadableSqlFragment('recipe', userId),
        ne(recipe.resultKind, 'playful'),
        isNull(recipe.moderationRemovedAt),
        ne(recipe.origin, 'web_imported'),
      ),
    )
    .orderBy(desc(recipeSave.createdAt), desc(recipe.id))

  return hydrateRecipeListItems(db, rows, requestLocale, fallbackName)
}

/**
 * Itens de UMA Coleção do próprio user (ownership por id+user_id ⇒ senão not_found), gateados por
 * visibilidade (C1), ordenados por `collection_item.created_at DESC` (mais recém-adicionados
 * primeiro). Mesmo split de duas queries de `loadSavedRecipes`.
 */
export async function loadCollectionItems(input: {
  db: Database
  userId: string
  collectionId: string
  requestLocale: string
  fallbackName: string
}): Promise<CollectionItemsResult> {
  const { db, userId, collectionId, requestLocale, fallbackName } = input

  const [own] = await db
    .select({ id: collection.id })
    .from(collection)
    .where(and(eq(collection.id, collectionId), eq(collection.userId, userId)))
  if (!own) return { kind: 'not_found' }

  const rows = await db
    .select(RECIPE_LIST_COLS)
    .from(collectionItem)
    .innerJoin(recipe, eq(collectionItem.recipeId, recipe.id))
    .leftJoin(recipeImage, and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)))
    .where(
      and(
        eq(collectionItem.collectionId, collectionId),
        viewerReadableSqlFragment('recipe', userId),
        ne(recipe.resultKind, 'playful'),
        isNull(recipe.moderationRemovedAt),
        ne(recipe.origin, 'web_imported'),
      ),
    )
    .orderBy(desc(collectionItem.createdAt), desc(recipe.id))

  const recipes = await hydrateRecipeListItems(db, rows, requestLocale, fallbackName)
  return { kind: 'ok', recipes }
}

// ── Interno: projeção compartilhada da lista de Receitas (espelha list-mine.ts) ────

/** Colunas da espinha da Receita + thumbnail, idênticas às de `listMyRecipes` (#61). */
const RECIPE_LIST_COLS = {
  id: recipe.id,
  origin: recipe.origin,
  visibility: recipe.visibility,
  resultKind: recipe.resultKind,
  lineageKind: recipe.lineageKind,
  originalLocale: recipe.originalLocale,
  updatedAt: recipe.updatedAt,
  moderationRemovedAt: recipe.moderationRemovedAt,
  imageUrl: recipeImage.blobUrl,
  imageProvenance: recipeImage.provenance,
} as const

type RecipeListBaseRow = {
  id: string
  origin: Origin
  visibility: Visibility
  resultKind: ResultKind
  lineageKind: LineageKind | null
  originalLocale: string
  updatedAt: Date
  moderationRemovedAt: Date | null
  imageUrl: string | null
  imageProvenance: ImageProvenance | null
}

/**
 * Segunda query (traduções) + montagem PURA — fatorada de `listMyRecipes` (list-mine.ts:56-118)
 * pra `loadSavedRecipes`/`loadCollectionItems` não forkarem a projeção. Preserva a ORDEM de `rows`
 * (o caller já ordenou); colhe o slug do `requestLocale` (#231) e delega a `resolveRecipeListItem`.
 */
async function hydrateRecipeListItems(
  db: Database,
  rows: RecipeListBaseRow[],
  requestLocale: string,
  fallbackName: string,
): Promise<RecipeListItem[]> {
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const translations = await db
    .select({
      recipeId: recipeTranslation.recipeId,
      locale: recipeTranslation.locale,
      titulo: recipeTranslation.titulo,
      descricao: recipeTranslation.descricao,
      passos: recipeTranslation.passos,
      notas: recipeTranslation.notas,
      provenance: recipeTranslation.provenance,
      stale: recipeTranslation.stale,
      slug: recipeTranslation.slug,
    })
    .from(recipeTranslation)
    .where(inArray(recipeTranslation.recipeId, ids))

  const byRecipe = new Map<string, TranslationRow[]>()
  const slugByRecipe = new Map<string, string>()
  for (const t of translations) {
    const list = byRecipe.get(t.recipeId) ?? []
    list.push({
      locale: t.locale,
      titulo: t.titulo,
      descricao: t.descricao,
      passos: t.passos,
      notas: t.notas,
      provenance: t.provenance,
      stale: t.stale,
    })
    byRecipe.set(t.recipeId, list)
    if (t.locale === requestLocale && t.slug != null) slugByRecipe.set(t.recipeId, t.slug)
  }

  return rows.map((r) =>
    resolveRecipeListItem(
      {
        id: r.id,
        origin: r.origin,
        visibility: r.visibility,
        resultKind: r.resultKind,
        lineageKind: r.lineageKind,
        originalLocale: r.originalLocale,
        updatedAt: r.updatedAt.toISOString(),
        moderationRemovida: r.moderationRemovedAt != null,
        imageUrl: r.imageUrl ?? undefined,
        imageProvenance: r.imageProvenance ?? undefined,
        slug: slugByRecipe.get(r.id),
        translations: byRecipe.get(r.id) ?? [],
      },
      requestLocale,
      fallbackName,
    ),
  )
}
