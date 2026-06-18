import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import {
  recipe,
  recipeTranslation,
  recipeIngredient,
  briefing,
  briefingItem,
  creationSession,
  generation,
} from '@/db/schema'
import { SCHEMA_VERSION_RECEITA, type CreationMode } from '@/domain/recipe'
import type { ClassifyResult } from '@/domain/generation'
import type { Strength } from '@/domain/briefing'
import type { Cozinha, Restricao, Unidade } from '@/domain/vocabulary'

/**
 * Persistência transacional da geração (issue #8, §6).
 *
 * Recebe o resultado já classificado (`ClassifyResult`) e grava em UMA transação,
 * pai antes de filhos. Caminhos:
 *  - SUCCESS/DEGRADED/PLAYFUL → recipe (visibility 'private' SEMPRE; result_kind =
 *    outcome; origin; owner) + recipe_translation (locale original, provenance
 *    'automatica_nao_revisada') + recipe_ingredient[] + (se houver) briefing +
 *    briefing_item[] + creation_session + generation.
 *  - IMPOSSIBLE → sem Receita: (se houver) briefing + creation_session + generation
 *    (recipe_id NULL). O Briefing — o PEDIDO — sobrevive mesmo sem entrega (AC4).
 *  - INVALID → persiste NADA (erro de sistema puro NÃO é episódio de criação,
 *    ADR-0006). Retorna sem tocar o DB; o Briefing NÃO nasce em erro de sistema.
 *
 * Quando `mode === 'structured'`, `briefing` é passado e gravado na MESMA transação,
 * SEMPRE antes da `creation_session` (que carrega a FK `briefing_id`). O CHECK
 * `creation_session_structured_briefing_chk` é a rede: structured sem briefing estoura
 * 23514 e a tx inteira reverte. Quando `mode === 'free_text'` (#88), `freeText` é gravado
 * CRU em `creation_session.free_text` como proveniência (sem briefing — o CHECK só exige
 * briefing para structured).
 *
 * `advisory` (Comentário consultivo) vive FORA da Receita, em `generation.advisory_comment`.
 * `quantidade` viaja como string|null (numeric(10,3) trafega como string), nunca number.
 */

export type PersistOrigin = 'ai_chat' | 'ai_structured' | 'ai_free_text'

// O Briefing (issue #11) é a ENTRADA estruturada gravada como proveniência. Presente
// SSE `mode === 'structured'`. `itens[].quantidade` é string|null (numeric trafega como
// string), NUNCA number; `ordem` é o índice (atribuído pelo handler/domínio).
export type PersistBriefing = {
  cozinha: Cozinha | null
  restricoes: Restricao[]
  porcoes: number | null
  dificuldade: number | null
  observacoes: string | null
  itens: {
    ingredientId: string | null
    rawText: string | null
    quantidade: string | null
    unidade: Unidade | null
    strength: Strength
    ordem: number
  }[]
}

export type PersistGenerationInput = {
  result: ClassifyResult
  mode: CreationMode
  origin: PersistOrigin
  ownerId: string
  model: string
  briefing?: PersistBriefing // NOVO — presente SSE mode === 'structured'
  freeText?: string // Texto livre CRU (#88) — presente SSE mode === 'free_text'
  // #15 (REAL): id de uma creation_session já existente, criada no COMEÇO da conversa.
  // Presente → REUSA a sessão (UPDATE em vez de INSERT): success/degraded/playful gravam
  // recipe_id + updated_at; impossible só bumpa updated_at (recipe_id segue NULL). A
  // generation é SEMPRE inserida (múltiplas por sessão são permitidas — re-destilação). A
  // posse é provada pelo ROUTE antes de chegar aqui (param DB-shaped, não auth-shaped).
  // Ausente → comportamento legado: INSERE uma nova creation_session (modo stateless de #12,
  // e o caminho lazy-create do stream quando o cliente não manda sessionId).
  existingSessionId?: string
}

export type PersistGenerationResult = {
  recipeId: string | null
  briefingId: string | null
  generationId: string
  creationSessionId: string
  outcome: 'success' | 'degraded' | 'playful' | 'impossible'
}

/**
 * Insere o Briefing (escalares + itens) DENTRO da transação corrente e devolve o id.
 * Os itens recebem `ordem` do próprio domínio (índice). NÃO é exportado: persistir o
 * Briefing fora de uma tx do `persistGeneration` quebraria a atomicidade pedido↔sessão.
 */
async function insertBriefing(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  b: PersistBriefing,
): Promise<string> {
  const [createdBriefing] = await tx
    .insert(briefing)
    .values({
      cozinha: b.cozinha,
      restricoes: b.restricoes,
      porcoes: b.porcoes,
      dificuldade: b.dificuldade,
      observacoes: b.observacoes,
    })
    .returning({ id: briefing.id })

  if (b.itens.length > 0) {
    await tx.insert(briefingItem).values(
      b.itens.map((it) => ({
        briefingId: createdBriefing.id,
        ingredientId: it.ingredientId,
        strength: it.strength,
        rawText: it.rawText,
        quantidade: it.quantidade, // string|null — NUNCA number.
        unidade: it.unidade,
        ordem: it.ordem,
      })),
    )
  }

  return createdBriefing.id
}

export async function persistGeneration(
  input: PersistGenerationInput,
): Promise<PersistGenerationResult | null> {
  const { result, mode, origin, ownerId, model, briefing: pedido, freeText, existingSessionId } = input

  // Erro de sistema puro: não é episódio de criação → nada é gravado (§6). O Briefing
  // também NÃO nasce em invalid (ADR-0006).
  if (result.outcome === 'invalid') return null

  if (result.outcome === 'impossible') {
    return getDb().transaction(async (tx) => {
      // Briefing ANTES da creation_session (FK briefing_id). O pedido sobrevive à
      // entrega impossible (AC4).
      const briefingId = pedido ? await insertBriefing(tx, pedido) : null
      let sessionId: string
      if (existingSessionId) {
        // #15: RETOMA a sessão (criada no começo da conversa). impossible NÃO entrega Receita
        // → recipe_id segue NULL; só bumpa updated_at (last-activity, ADR-0006). NÃO INSERE
        // uma 2ª sessão (senão um impossible numa conversa retomada duplicaria a sessão).
        await tx
          .update(creationSession)
          .set({ updatedAt: sql`now()` })
          .where(eq(creationSession.id, existingSessionId))
        sessionId = existingSessionId
      } else {
        const [session] = await tx
          .insert(creationSession)
          .values({ userId: ownerId, mode, recipeId: null, briefingId, freeText: freeText ?? null })
          .returning({ id: creationSession.id })
        sessionId = session.id
      }
      const [gen] = await tx
        .insert(generation)
        .values({
          creationSessionId: sessionId,
          recipeId: null,
          outcome: 'impossible',
          advisoryComment: result.advisory,
          model,
          schemaVersion: SCHEMA_VERSION_RECEITA,
        })
        .returning({ id: generation.id })
      return {
        recipeId: null,
        briefingId,
        generationId: gen.id,
        creationSessionId: sessionId,
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

    // Briefing (o PEDIDO) ANTES da creation_session (FK briefing_id). Distinto da
    // Receita entregue (AC4): tabelas separadas, a sessão aponta para AMBOS.
    const briefingId = pedido ? await insertBriefing(tx, pedido) : null

    let sessionId: string
    if (existingSessionId) {
      // #15: RETOMA a sessão (criada no começo da conversa) → ANEXA a Receita destilada
      // (UPDATE recipe_id + updated_at). NÃO INSERE uma 2ª sessão. briefing_id NÃO é tocado:
      // conversation não tem briefing (pedido é null aqui), e re-destilar não reescreve o
      // pedido original. A generation abaixo é sempre INSERIDA (múltiplas por sessão).
      await tx
        .update(creationSession)
        .set({ recipeId: createdRecipe.id, updatedAt: sql`now()` })
        .where(eq(creationSession.id, existingSessionId))
      sessionId = existingSessionId
    } else {
      const [session] = await tx
        .insert(creationSession)
        .values({ userId: ownerId, mode, recipeId: createdRecipe.id, briefingId, freeText: freeText ?? null })
        .returning({ id: creationSession.id })
      sessionId = session.id
    }

    const [gen] = await tx
      .insert(generation)
      .values({
        creationSessionId: sessionId,
        recipeId: createdRecipe.id,
        outcome: result.outcome,
        advisoryComment: result.advisory,
        model,
        schemaVersion: SCHEMA_VERSION_RECEITA,
      })
      .returning({ id: generation.id })

    return {
      recipeId: createdRecipe.id,
      briefingId,
      generationId: gen.id,
      creationSessionId: sessionId,
      outcome: result.outcome,
    }
  })
}
