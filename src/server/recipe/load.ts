import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import {
  recipe,
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
}

export async function loadRecipeRows(db: Database, id: string): Promise<LoadedRecipeRows | null> {
  const [row] = await db.select().from(recipe).where(eq(recipe.id, id))
  if (!row) return null

  // As três leituras seguintes são independentes entre si: em paralelo. A Autoria (#129) só é
  // buscada quando há dono humano (`owner_id` não-NULL) — Catálogo/sistema dispensa a query.
  const [translations, ingredients, tags, authorRows] = await Promise.all([
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
  ])

  const authorRow = authorRows[0]
  const author: RecipeAuthor | undefined =
    authorRow != null ? { name: authorRow.name, handle: authorRow.handle } : undefined

  return {
    recipe: row,
    translations,
    ingredients,
    tags: tags.map((t) => t.nome),
    ...(author ? { author } : {}),
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
