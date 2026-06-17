import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeIngredient, recipeTag, tag, ingredient } from '@/db/schema'
import type { RecipeRow, TranslationRow, IngredientItem } from '@/domain/recipe-read'

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
}

export async function loadRecipeRows(db: Database, id: string): Promise<LoadedRecipeRows | null> {
  const [row] = await db.select().from(recipe).where(eq(recipe.id, id))
  if (!row) return null

  // As três leituras seguintes são independentes entre si: em paralelo.
  const [translations, ingredients, tags] = await Promise.all([
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
  ])

  return {
    recipe: row,
    translations,
    ingredients,
    tags: tags.map((t) => t.nome),
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
