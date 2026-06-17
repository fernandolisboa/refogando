import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { ingredient, recipeIngredient } from '@/db/schema'

/**
 * Resolução de um Item raw → Ingrediente canônico (issue #19, AC2).
 *
 * UPDATE PURO de `recipe_ingredient.ingredient_id`. `ingredient_id` NÃO é campo
 * TRADUZÍVEL (stale-rule.ts) ⇒ NÃO chama `applyEdit`, NÃO marca stale, NÃO re-embeda.
 * A busca cross-locale de #9 pega o vínculo AO VIVO (CTEs `ingredient_canonical*` fazem
 * JOIN em `ingredient_translation`, all-locale) — nenhuma mudança no SQL de `search.ts`.
 *
 * O SELECT de existência do `ingredientId` é OBRIGATÓRIO, não redundante: o UPDATE filtra
 * SÓ por `(id=itemId AND recipe_id=recipeId)`, NUNCA por `ingredientId` — então um
 * `ingredientId` bem-formado mas INEXISTENTE, gravado num item que EXISTE, atingiria 1
 * linha e dispararia a FK `recipe_ingredient.ingredient_id → ingredient.id` (23503 → 500).
 * O SELECT converte isso num `false` ANTES do write (route mapeia 404 leak-safe). O UPDATE
 * escopa por `(id=itemId AND recipe_id=recipeId)`: 0 linhas (item inexistente ou de outra
 * receita) ⇒ `false` (404 leak-safe).
 */

export async function resolveItem(
  db: Database,
  input: { recipeId: string; itemId: string; ingredientId: string },
): Promise<boolean> {
  const [ing] = await db
    .select({ id: ingredient.id })
    .from(ingredient)
    .where(eq(ingredient.id, input.ingredientId))
  if (!ing) return false

  const updated = await db
    .update(recipeIngredient)
    .set({ ingredientId: input.ingredientId })
    .where(and(eq(recipeIngredient.id, input.itemId), eq(recipeIngredient.recipeId, input.recipeId)))
    .returning({ id: recipeIngredient.id })

  return updated.length > 0
}
