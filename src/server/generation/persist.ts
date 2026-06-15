import { getDb } from '@/server/deps'
import { recipe, recipeTranslation, recipeIngredient, creationSession, generation } from '@/db/schema'
import { SCHEMA_VERSION_RECEITA, type CreationMode } from '@/domain/recipe'
import type { ClassifyResult } from '@/domain/generation'

/**
 * Persistência transacional da geração (issue #8, §6).
 *
 * Recebe o resultado já classificado (`ClassifyResult`) e grava em UMA transação,
 * pai antes de filhos. Caminhos:
 *  - SUCCESS/DEGRADED/PLAYFUL → recipe (visibility 'private' SEMPRE; result_kind =
 *    outcome; origin; owner) + recipe_translation (locale original, provenance
 *    'automatica_nao_revisada') + recipe_ingredient[] + creation_session + generation.
 *  - IMPOSSIBLE → sem Receita: só creation_session + generation (recipe_id NULL).
 *  - INVALID → persiste NADA (erro de sistema puro NÃO é episódio de criação,
 *    ADR-0006). Retorna sem tocar o DB.
 *
 * `advisory` (Comentário consultivo) vive FORA da Receita, em `generation.advisory_comment`.
 * `quantidade` viaja como string|null (numeric(10,3) trafega como string), nunca number.
 */

export type PersistOrigin = 'ai_chat' | 'ai_structured'

export type PersistGenerationInput = {
  result: ClassifyResult
  mode: CreationMode
  origin: PersistOrigin
  ownerId: string
  model: string
}

export type PersistGenerationResult = {
  recipeId: string | null
  generationId: string
  creationSessionId: string
  outcome: 'success' | 'degraded' | 'playful' | 'impossible'
}

export async function persistGeneration(
  input: PersistGenerationInput,
): Promise<PersistGenerationResult | null> {
  const { result, mode, origin, ownerId, model } = input

  // Erro de sistema puro: não é episódio de criação → nada é gravado (§6).
  if (result.outcome === 'invalid') return null

  if (result.outcome === 'impossible') {
    return getDb().transaction(async (tx) => {
      const [session] = await tx
        .insert(creationSession)
        .values({ userId: ownerId, mode, recipeId: null })
        .returning({ id: creationSession.id })
      const [gen] = await tx
        .insert(generation)
        .values({
          creationSessionId: session.id,
          recipeId: null,
          outcome: 'impossible',
          advisoryComment: result.advisory,
          model,
          schemaVersion: SCHEMA_VERSION_RECEITA,
        })
        .returning({ id: generation.id })
      return {
        recipeId: null,
        generationId: gen.id,
        creationSessionId: session.id,
        outcome: 'impossible',
      }
    })
  }

  // success | degraded | playful: Receita privada + tradução + ingredientes.
  const r = result.recipe
  return getDb().transaction(async (tx) => {
    const [createdRecipe] = await tx
      .insert(recipe)
      .values({
        origin,
        visibility: 'private', // SEMPRE privado (obrigatório p/ playful — CHECK 23514).
        resultKind: result.outcome,
        ownerId,
        originalLocale: r.originalLocale,
        cozinha: r.cozinha,
        categoria: r.categoria,
        restricoes: r.restricoes,
        porcoes: r.porcoes,
        dificuldade: r.dificuldade,
        // schemaVersion: default (SCHEMA_VERSION_RECEITA).
      })
      .returning({ id: recipe.id })

    await tx.insert(recipeTranslation).values({
      recipeId: createdRecipe.id,
      locale: r.originalLocale,
      titulo: r.titulo,
      descricao: r.descricao,
      passos: r.passos,
      notas: r.notas,
      provenance: 'automatica_nao_revisada',
    })

    if (r.ingredientes.length > 0) {
      await tx.insert(recipeIngredient).values(
        r.ingredientes.map((item, index) => ({
          recipeId: createdRecipe.id,
          ingredientId: null,
          ordem: index,
          quantidade: item.quantidade,
          unidade: item.unidade,
          rawText: item.rawText,
        })),
      )
    }

    const [session] = await tx
      .insert(creationSession)
      .values({ userId: ownerId, mode, recipeId: createdRecipe.id })
      .returning({ id: creationSession.id })

    const [gen] = await tx
      .insert(generation)
      .values({
        creationSessionId: session.id,
        recipeId: createdRecipe.id,
        outcome: result.outcome,
        advisoryComment: result.advisory,
        model,
        schemaVersion: SCHEMA_VERSION_RECEITA,
      })
      .returning({ id: generation.id })

    return {
      recipeId: createdRecipe.id,
      generationId: gen.id,
      creationSessionId: session.id,
      outcome: result.outcome,
    }
  })
}
