import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeIngredient, recipeTranslation } from '@/db/schema'
import { mergeIngredientNameEdits, type IngredienteTraduzido } from '@/domain/ingredient-name-edit'

/**
 * Curador edita o NOME de ingrediente traduzido (issue #498, ADR-0031 companheiro (iii)) —
 * grava no `ingredientes jsonb` de `recipe_translation` por `ordem`, PRESERVANDO a medida
 * (quantidade/unidade em `recipe_ingredient`) e o `raw_text` — invariantes, nunca tocados
 * aqui. A resolução (`resolveRecipeView`, ADR-0030) mantém-se coerente porque o merge puro
 * (`mergeIngredientNameEdits`, `@/domain/ingredient-name-edit`) grava `nomeOrigem` = o
 * `raw_text` ATUAL do item (não o antigo), garantindo que o nome recém-editado seja exibido.
 *
 * Espelha a forma de `editCatalogRecipe` (gate ANTES do efeito, sem transação externa — a
 * escrita é uma única UPDATE idempotente) mas com ESCOPO DELIBERADAMENTE MAIS ESTREITO: só o
 * `ingredientes jsonb`, nunca titulo/descricao/passos/notas/categorização (isso segue
 * exclusivo de `editCatalogRecipe`/catálogo). O CALLER (rota) já resolveu o gate de
 * comunidade/moderação — este serviço não repete a checagem de visibilidade.
 */

export type EditIngredientNamesResult =
  | { kind: 'ok' }
  | { kind: 'translation_not_found' }
  | { kind: 'invalid_ordem'; ordem: number }

export async function editTranslatedIngredientNames(
  db: Database,
  input: {
    recipeId: string
    locale: string
    edits: ReadonlyArray<{ ordem: number; nome: string }>
  },
): Promise<EditIngredientNamesResult> {
  // Sem edições: no-op idempotente. Ainda exige a linha existir (mesmo contrato do gate
  // abaixo) para não devolver 200 silencioso num locale sem tradução nenhuma.
  const [tr] = await db
    .select({ ingredientes: recipeTranslation.ingredientes })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, input.recipeId), eq(recipeTranslation.locale, input.locale)))
  if (!tr) return { kind: 'translation_not_found' }

  if (input.edits.length === 0) return { kind: 'ok' }

  // `raw_text` ATUAL por `ordem` — a MEDIDA/raw_text vivem só aqui (fonte única, Direção B); o
  // `ordem` editado precisa corresponder a um item REAL com raw_text não-vazio (item sem nome
  // — ex. cabeçalho de seção — não tem nome traduzível).
  const ingredientRows = await db
    .select({ ordem: recipeIngredient.ordem, rawText: recipeIngredient.rawText })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, input.recipeId))
  const rawTextByOrdem = new Map<number, string>()
  for (const row of ingredientRows) {
    if (row.rawText != null && row.rawText.trim() !== '') rawTextByOrdem.set(row.ordem, row.rawText)
  }

  for (const edit of input.edits) {
    if (!rawTextByOrdem.has(edit.ordem)) return { kind: 'invalid_ordem', ordem: edit.ordem }
  }

  const merged = mergeIngredientNameEdits(
    (tr.ingredientes as ReadonlyArray<IngredienteTraduzido> | null) ?? null,
    input.edits.map((edit) => ({
      ordem: edit.ordem,
      nome: edit.nome,
      rawTextAtual: rawTextByOrdem.get(edit.ordem)!,
    })),
  )

  await db
    .update(recipeTranslation)
    .set({ ingredientes: merged, updatedAt: new Date() })
    .where(and(eq(recipeTranslation.recipeId, input.recipeId), eq(recipeTranslation.locale, input.locale)))

  return { kind: 'ok' }
}
