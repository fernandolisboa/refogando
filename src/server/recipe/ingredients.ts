import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeIngredient } from '@/db/schema'
import type { Unidade } from '@/domain/vocabulary'

/**
 * Item de ingrediente na forma de ESCRITA (espelha o create estruturado e o owner-edit): texto livre
 * monolíngue + quantidade `numeric(10,3)` como **string|null** (NUNCA number — precisão exata) +
 * unidade enum|null. `ingredientId` é sempre null aqui (texto livre; o vínculo canônico de alérgeno
 * é dormente, #130).
 */
export type IngredientWriteInput = {
  rawText: string | null
  quantidade: string | null
  unidade: Unidade | null
}

/**
 * Reescreve a lista INTEIRA de ingredientes de uma Receita — delete-all + reinsert do zero, numa
 * transação (atômico no eixo). Forma do create.ts: `ingredientId` null, `ordem` por índice,
 * `quantidade` string|null. Owner-AGNÓSTICO: escopado SÓ por `recipeId`; a AUTORIZAÇÃO é
 * responsabilidade do caller (owner-edit prova posse via `owner_id`; a edição de catálogo prova
 * `origin='catalog'`). Extraído de `owner-edit.ts` p/ reuso na edição de catálogo (#238, ADR-0026
 * emenda dec.9) — antes era inline e o `editOwnRecipe` é owner-scoped (inalcançável p/ owner-null).
 */
export async function replaceIngredients(
  db: Database,
  recipeId: string,
  ingredientes: ReadonlyArray<IngredientWriteInput>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId))
    if (ingredientes.length > 0) {
      await tx.insert(recipeIngredient).values(
        ingredientes.map((it, i) => ({
          recipeId,
          ingredientId: null,
          ordem: i,
          quantidade: it.quantidade,
          unidade: it.unidade,
          rawText: it.rawText,
        })),
      )
    }
  })
}
