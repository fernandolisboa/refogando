import { and, eq, sql } from 'drizzle-orm'
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
import { SCHEMA_VERSION_RECEITA, type CreationMode, type LineageKind } from '@/domain/recipe'
import { slugForNewTranslation } from '@/server/recipe/slug'
import type { ClassifyResult } from '@/domain/generation'
import { computeTextCost, type TextUsage } from '@/domain/text-cost'
import type { Strength, PromptStamp } from '@/domain/briefing'
import type { Cozinha, Restricao, Unidade } from '@/domain/vocabulary'
import { conciliarTempoPreparo } from '@/domain/tempo'
import { assertRecipeGenSlotInTx } from '@/server/quota/atomic'

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

/** Tipo da transação do Drizzle (mesmas APIs de query que `Database`) — reusado no `tx` opcional. */
type PersistTx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

// O Briefing (issue #11) é a ENTRADA estruturada gravada como proveniência. Presente
// SSE `mode === 'structured'`. `itens[].quantidade` é string|null (numeric trafega como
// string), NUNCA number; `ordem` é o índice (atribuído pelo handler/domínio).
export type PersistBriefing = {
  cozinha: Cozinha | null
  restricoes: Restricao[]
  porcoes: number | null
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
  // posse é provada pelo ROUTE antes de chegar aqui, mas a persistência TAMBÉM se auto-verifica
  // (defense-in-depth, fail-closed): confere `user_id === ownerId` e escopa todo UPDATE por
  // ownerId — um existingSessionId não-possuído NUNCA anexa geração/Receita à sessão alheia
  // (estoura erro interno; só dispara num bug do route, nunca em fluxo normal).
  // Ausente → comportamento legado: INSERE uma nova creation_session (modo stateless de #12,
  // e o caminho lazy-create do stream quando o cliente não manda sessionId).
  existingSessionId?: string
  // #20 (REGENERAÇÃO): linhagem da NOVA Receita imutável. Presente → a Receita criada nasce
  // ligada à predecessora (`parentRecipeId`) com `lineageKind`. AUSENTE → comportamento legado
  // (parent_recipe_id NULL, lineage_kind NULL — toda geração de #8/#11/#12/#88). Para
  // `regenerated`, o `origin` HERDA o da predecessora (PersistOrigin é ai_* — por isso #20 só
  // regenera Receitas ai_*) e a Receita reusa a `existingSessionId` da predecessora (sem 2ª
  // sessão; múltiplas generations por sessão são permitidas). `derivedDiff` segue NULL aqui:
  // regenerated NÃO carrega diff (PRD historia 292); só `edited` (a derivada de #17) o carrega.
  lineage?: { parentRecipeId: string; lineageKind: LineageKind }
  // #131 (CARRY-FORWARD da Imagem): a Receita criada HERDA este image_id (mesmo blob, sem arquivo
  // novo — ADR-0016). Presente SÓ na regeneração (passa o image_id da predecessora); AUSENTE em
  // toda geração de raiz (#8/#11/#12/#88), que nasce sem imagem ⇒ NULL.
  imageId?: string | null
  // #222 (LINHAGEM da Galeria, ADR-0022 dec.1/3): a Receita criada HERDA esta lineage_id da
  // predecessora — usado SÓ na regeneração same-owner (#20: a galeria é COMPARTILHADA entre versões,
  // espelhando o carry-forward). ORTOGONAL ao `lineage{parentRecipeId,lineageKind}` acima (linhagem
  // de VERSIONAMENTO, regenerated-only): `lineageId` é a chave OPACA da galeria. AUSENTE em toda
  // geração de RAIZ (#8/#11/#12/#88 e a conversa) ⇒ a coluna toma o DB default (chave própria fresca,
  // galeria nova). NUNCA passar `null` explícito (violaria o NOT NULL): ausente ⇒ undefined ⇒ default.
  lineageId?: string
  // #420 (ADR-0029): carimbo de versão do PROMPT/EIXOS que produziram esta geração (`{ version, axes }`,
  // montado por `promptStampFor` na borda). Gravado em `generation.prompt_stamp` (jsonb) tanto no caminho
  // impossible quanto no de sucesso. AUSENTE (linhas legadas / callers que ainda não resolvem eixos) ⇒
  // undefined ⇒ NULL. Correlaciona depois qual composição produziu Receitas que as pessoas guardam.
  promptStamp?: PromptStamp
  // #423 (ADR-0029 dec.6) — "gerar 2, o usuário escolhe". As DUAS gerações de um lote compartilham o
  // MESMO `variantGroupId` (o caller o gera UMA vez e chama persistGeneration 2×), cada uma com o seu
  // `variantLabel` (o pólo). Gravados em `generation.variant_group_id`/`variant_label`. AUSENTES na
  // geração single (legado) ⇒ undefined ⇒ NULL. `variant_chosen` NASCE NULL (a rota de escolha o marca).
  variantGroupId?: string
  variantLabel?: string
  // #446 (TOCTOU do teto): gate ATÔMICO de cota de geração de RECEITA. Quando presente, a PRIMEIRA
  // operação da transação de persistência toma o advisory lock do usuário, RECONTA as `generation` na
  // janela 24h e DECIDE — estourou ⇒ LANÇA QuotaExceededError e a tx REVERTE (nada persiste), que o
  // caller mapeia p/ 429. Ausente ⇒ sem gate (papel ∞ / callers legados sem teto). O pré-check da rota
  // continua como otimização barata (early-reject sem tocar o Claude); ESTE é a enforcement real.
  quota?: { userId: string; cap: number }
  // #446 (variar2): transação FORNECIDA pelo caller. Presente ⇒ persiste NESTA tx (não abre a própria) —
  // usado pelo "gerar 2" p/ gravar as DUAS variações sob UM único advisory lock (o caller toma o lock +
  // reconta os 2 slots ANTES, então cada persist vai com `quota` AUSENTE aqui). Ausente ⇒ abre a própria
  // tx (todos os demais callers) e roda o gate `quota` internamente.
  tx?: PersistTx
  // #463: telemetria de custo (input/output tokens) da chamada que produziu esta geração, lida pela borda
  // de `out.usage` (o seam RealClaudeClient a anexa). Deriva o `cost_usd` SNAPSHOT via `computeTextCost`
  // e grava input_tokens/output_tokens/cost_usd na linha `generation`. AUSENTE (FakeClaudeClient / callers
  // legados / telemetria indisponível) ⇒ undefined ⇒ tudo NULL (best-effort honesto, não finge custo 0).
  usage?: TextUsage
}

export type PersistGenerationResult = {
  recipeId: string | null
  briefingId: string | null
  generationId: string
  creationSessionId: string
  outcome: 'success' | 'degraded' | 'playful' | 'impossible'
  // Slug + locale CONGELADOS na criação (#231/#229, ADR-0020): o slug per-locale da tradução do
  // ORIGINAL recém-criado e o seu `locale`. SÓ no caminho com Receita (success/degraded/playful) —
  // `impossible` não cria Receita/tradução ⇒ ambos `undefined`. O caller (route/stream) os devolve ao
  // cliente pra montar o link canônico `/{locale}/recipes/<slug>` sem um 2º GET.
  slug?: string
  locale?: string
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
      // #421 (ADR-0029 dec.4): a Dificuldade DEIXOU de ser entrada — a coluna `briefing.dificuldade`
      // fica DORMENTE (default NULL). Não é dropada (evita migração destrutiva); só não é mais escrita.
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

/**
 * #15 — guarda de posse fail-closed para o caminho `existingSessionId`. SELECT da sessão
 * por (id, user_id=ownerId) DENTRO da tx; se não achar (não-possuída ou inexistente), ESTOURA
 * — assim uma sessão alheia NUNCA recebe geração/Receita anexada e a tx inteira reverte.
 * O route já prova a posse antes de chamar `persistGeneration`; isto é defense-in-depth, então
 * o erro só dispara num bug de programação (nunca em fluxo normal) — daí o `throw`, não um
 * insert silencioso numa sessão estranha. NÃO é exportado (detalhe interno da persistência).
 */
async function assertOwnedSession(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  sessionId: string,
  ownerId: string,
): Promise<void> {
  const [owned] = await tx
    .select({ id: creationSession.id })
    .from(creationSession)
    .where(and(eq(creationSession.id, sessionId), eq(creationSession.userId, ownerId)))
  if (!owned) {
    throw new Error(
      `persistGeneration: existingSessionId não-possuído ou inexistente (defense-in-depth fail-closed)`,
    )
  }
}

export async function persistGeneration(
  input: PersistGenerationInput,
): Promise<PersistGenerationResult | null> {
  const { result, mode, origin, ownerId, model, briefing: pedido, freeText, existingSessionId, lineage, imageId, lineageId, promptStamp, variantGroupId, variantLabel, quota, tx: providedTx, usage } = input

  // #463: custo SNAPSHOT da tabela de preço EM CÓDIGO (puro). usage ausente OU modelo fora da tabela ⇒
  // null (honesto — não finge 0). numeric → string|null no insert (precisão exata, espelha image_generation).
  const costUsd = computeTextCost(usage, model)
  // Colunas de custo compartilhadas pelos DOIS caminhos (impossible e sucesso) — nascem NULL sem telemetria.
  const costCols = {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    costUsd: costUsd != null ? costUsd.toString() : null,
  }

  // Invariante da linhagem (defense-in-depth): persistGeneration só materializa linhagem
  // `regenerated` (#20) — uma derivada `edited` (#17) nasce no fluxo próprio de derive.ts, NUNCA
  // por aqui. `regenerated` SEMPRE aponta pra predecessora. Falha fechado contra bug de chamador.
  if (lineage && (lineage.lineageKind !== 'regenerated' || !lineage.parentRecipeId)) {
    throw new Error("persistGeneration: lineage inválida (só 'regenerated' com parentRecipeId)")
  }

  // Erro de sistema puro: não é episódio de criação → nada é gravado (§6). O Briefing
  // também NÃO nasce em invalid (ADR-0006).
  if (result.outcome === 'invalid') return null

  // Corpo transacional (impossible OU sucesso), parametrizado pela `tx`. #446: `tx` ou é a FORNECIDA
  // pelo caller (variar2 — as 2 variações compartilham UMA tx + UM lock) ou a própria (todos os demais).
  const runInTx = async (tx: PersistTx): Promise<PersistGenerationResult | null> => {
    // #446: gate ATÔMICO de cota — PRIMEIRA op da tx (advisory lock + recontagem + decisão). Estourou ⇒
    // LANÇA QuotaExceededError e a tx reverte (NADA persiste). impossible TAMBÉM conta pro teto (o custo
    // do Claude já foi gasto). No caminho `providedTx` (variar2) `quota` vem AUSENTE: o caller já gateou
    // os 2 slots sob o lock ANTES de chamar — não se reconta por variação (senão a 2ª se auto-barraria).
    if (quota) await assertRecipeGenSlotInTx(tx, quota)

    if (result.outcome === 'impossible') {
      // Briefing ANTES da creation_session (FK briefing_id). O pedido sobrevive à
      // entrega impossible (AC4).
      const briefingId = pedido ? await insertBriefing(tx, pedido) : null
      let sessionId: string
      if (existingSessionId) {
        // #15: RETOMA a sessão (criada no começo da conversa). impossible NÃO entrega Receita
        // → recipe_id segue NULL; só bumpa updated_at (last-activity, ADR-0006). NÃO INSERE
        // uma 2ª sessão (senão um impossible numa conversa retomada duplicaria a sessão).
        // Defense-in-depth (fail-closed): confere posse ANTES de tocar a sessão — um
        // existingSessionId não-possuído estoura (bug do route, nunca fluxo normal).
        await assertOwnedSession(tx, existingSessionId, ownerId)
        await tx
          .update(creationSession)
          .set({ updatedAt: sql`now()` })
          .where(and(eq(creationSession.id, existingSessionId), eq(creationSession.userId, ownerId)))
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
          // #420 (ADR-0029): carimbo do prompt/eixos. AUSENTE ⇒ undefined ⇒ NULL (default da coluna).
          promptStamp,
          // #423: agrupamento/rótulo da variação. AUSENTES no single ⇒ undefined ⇒ NULL.
          variantGroupId,
          variantLabel,
          // #463: tokens + cost_usd snapshot (best-effort; NULL sem telemetria).
          ...costCols,
        })
        .returning({ id: generation.id })
      return {
        recipeId: null,
        briefingId,
        generationId: gen.id,
        creationSessionId: sessionId,
        outcome: 'impossible',
      }
    }

    // success | degraded | playful: Receita privada + tradução + ingredientes.
    const r = result.recipe
    // Tempo de preparo (#261, ADR-0023 dec.3): reconcilia o par estimado pela IA — ativo > total
    // (ou ativo sem total) descarta o ativo e mantém o total, NÃO invalida (tempo é baixo-risco).
    // Garante o CHECK recipe_tempo_consistency_chk no INSERT.
    const tempo = conciliarTempoPreparo(r.tempoAtivoMin, r.tempoTotalMin)
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
        // Tempo de preparo (#261, ADR-0023): já reconciliado acima (conciliarTempoPreparo).
        tempoAtivoMin: tempo.tempoAtivoMin,
        tempoTotalMin: tempo.tempoTotalMin,
        // #20: linhagem (regenerated) quando presente; ausente → NULL (toda geração legada).
        // `origin` foi HERDADO no caller (PersistOrigin ai_*). `derived_diff` segue NULL —
        // regenerated não carrega diff (só `edited`, em derive.ts). SÓ no INSERT (o trigger
        // recipe_origin_immutable estoura P0001 em UPDATE de origin, nunca aqui).
        parentRecipeId: lineage?.parentRecipeId,
        lineageKind: lineage?.lineageKind,
        // #131 carry-forward: a regeneração HERDA o image_id da predecessora (mesmo blob, ADR-0016).
        // AUSENTE (geração de raiz) ⇒ undefined ⇒ NULL (Receita nasce sem imagem).
        imageId: imageId ?? null,
        // #222: a regeneração HERDA a lineage_id da predecessora (galeria compartilhada, ADR-0022
        // dec.3); AUSENTE (geração de raiz) ⇒ undefined ⇒ DB default (gen_random_uuid → galeria
        // própria nova). NUNCA `null` (violaria o NOT NULL) — `?? undefined` força o default.
        lineageId: lineageId ?? undefined,
        // schemaVersion: default (SCHEMA_VERSION_RECEITA).
      })
      .returning({ id: recipe.id })

    // Slug por idioma (#229, ADR-0020 dec.4): congelado na criação, do título do locale
    // original; desambiguado contra os slugs já em uso no locale.
    const slug = await slugForNewTranslation(tx, { locale: r.originalLocale, title: r.titulo })

    await tx.insert(recipeTranslation).values({
      recipeId: createdRecipe.id,
      locale: r.originalLocale,
      titulo: r.titulo,
      descricao: r.descricao,
      passos: r.passos,
      notas: r.notas,
      slug,
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
          rawText: item.nome, // gen schema emite `nome` (sem medida) → coluna raw_text (ADR-0009 Adendo)
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
      // Defense-in-depth (fail-closed): confere posse ANTES de anexar a Receita — um
      // existingSessionId não-possuído estoura (bug do route, nunca fluxo normal).
      await assertOwnedSession(tx, existingSessionId, ownerId)
      await tx
        .update(creationSession)
        .set({ recipeId: createdRecipe.id, updatedAt: sql`now()` })
        .where(and(eq(creationSession.id, existingSessionId), eq(creationSession.userId, ownerId)))
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
        // #420 (ADR-0029): carimbo do prompt/eixos. AUSENTE ⇒ undefined ⇒ NULL (default da coluna).
        promptStamp,
        // #423 (ADR-0029 dec.6): agrupamento/rótulo da variação. AUSENTES no single ⇒ undefined ⇒ NULL.
        // `variant_chosen` NASCE NULL (a rota de escolha o marca, server-authoritative por owner).
        variantGroupId,
        variantLabel,
        // #463: tokens + cost_usd snapshot (best-effort; NULL sem telemetria).
        ...costCols,
      })
      .returning({ id: generation.id })

    return {
      recipeId: createdRecipe.id,
      briefingId,
      generationId: gen.id,
      creationSessionId: sessionId,
      outcome: result.outcome,
      // #231/#229: slug + locale congelados (do INSERT da tradução do original) pro link canônico.
      slug,
      locale: r.originalLocale,
    }
  }

  // #446: dispatch — `providedTx` (variar2, tx compartilhada sob UM lock) OU a própria transação.
  return providedTx ? runInTx(providedTx) : getDb().transaction(runInTx)
}
