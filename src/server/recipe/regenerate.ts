import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import type { ClaudeClient } from '@/server/claude/client'
import {
  recipe,
  recipeTranslation,
  recipeIngredient,
  creationSession,
  briefing as briefingTable,
  briefingItem,
  transcriptMessage,
} from '@/db/schema'
import {
  shouldSuggestNewImage,
  visualChangesBetween,
  type ImageReviewSnapshot,
} from '@/domain/image-review'
import {
  buildBriefingPrompt,
  buildFreeTextPrompt,
  buildConversationPrompt,
  type Briefing,
  type BriefingItem,
} from '@/domain/briefing'
import type { TranscriptMessage } from '@/domain/transcript'
import type { Cozinha, Restricao, Unidade } from '@/domain/vocabulary'
import { classify } from '@/domain/generation'
import { persistGeneration, type PersistOrigin } from '@/server/generation/persist'
import { embedTranslation } from '@/server/embedding/recompute'
import { loadRecentRecipeGenAt } from '@/server/generation/quota'
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { decideRecipeGenQuota } from '@/domain/recipe-gen-quota'

/**
 * REGENERAÇÃO — nova versão IMUTÁVEL por linhagem (issue #20). O KEYSTONE de "Minhas
 * criações": regenerar uma Receita PRÓPRIA NUNCA sobrescreve — cria uma NOVA linha de
 * `recipe` do leitor, ligada à predecessora por `parent_recipe_id`/`lineage_kind='regenerated'`.
 * As versões anteriores ficam intactas (apagar uma intermediária só anula o ponteiro — set null;
 * história 47/289).
 *
 * Fluxo (o GATE é o PRIMEIRO toque de DB, ANTES de qualquer chamada paga ao Claude):
 *   1. SELECT da predecessora: owner_id + origin (+ a creation_session que a entregou).
 *      - não-própria (inclui catálogo, owner_id NULL) → 404 leak-safe (NUNCA 403).
 *      - origin não-ai_* (catalog / user_edited, a derivada de #17) → 409 sem_fonte (sem
 *        prompt recuperável).
 *   2. RECUPERA o prompt pela `mode` da creation_session predecessora:
 *      - conversation → reconstrói de transcript_message (buildConversationPrompt);
 *      - structured   → de briefing/briefing_item (buildBriefingPrompt);
 *      - free_text    → de creation_session.free_text (buildFreeTextPrompt).
 *      Fonte irrecuperável (transcrição apagada via #15, sessão/briefing ausente) → 409 sem_fonte,
 *      NUNCA 500.
 *   3. generateRecipe(prompt) → classify → mapeia:
 *      - success/degraded/playful → INSERE a NOVA Receita (origin HERDADO, visibility private,
 *        result_kind do classify FRESCO, lineage regenerated, derived_diff NULL) + uma nova
 *        generation na MESMA creation_session (reusa — sem 2ª sessão) → embedTranslation (entra
 *        na Busca, #14) → { kind:'ok', outcome, recipeId, advisory }.
 *      - impossible → { kind:'impossible', advisory } (nada de Receita; persistido como episódio).
 *      - invalid → { kind:'invalid' } (erro de sistema; NADA é persistido — ADR-0006).
 *
 * REUSO (decisão #20): estende `persistGeneration` com `lineage` opcional e reusa o caminho
 * `existingSessionId` (insere a generation na sessão da predecessora). origin INHERITED no
 * INSERT (PersistOrigin é ai_* — por isso #20 só regenera Receitas ai_*).
 */

// Origins ai_* que a regeneração suporta (carregam fonte de prompt recuperável). catalog e
// user_edited (a derivada) NÃO têm fonte → 409 sem_fonte.
const AI_ORIGINS = new Set<string>(['ai_chat', 'ai_structured', 'ai_free_text'])

export type RegenerateResult =
  // `imageReviewSuggested` (#131): a nova versão HERDOU a imagem da predecessora E uma mudança
  // VISUAL (título/ingredientes/cozinha, comparada contra a predecessora) sugere revisar a foto.
  | { kind: 'ok'; outcome: 'success' | 'degraded' | 'playful'; recipeId: string; advisory: string | null; imageReviewSuggested: boolean }
  | { kind: 'impossible'; advisory: string | null }
  | { kind: 'invalid' } //          erro de sistema upstream (refusal/max_tokens/parse_failed)
  | { kind: 'not_found' } //         não-própria (404 leak-safe)
  | { kind: 'sem_fonte' } //         origin não-ai_* OU fonte de prompt irrecuperável (409)
  // Teto diário de geração de RECEITA por papel estourado (#167) → 429 limite_geracao. retryAfterMs
  // = countdown até o próximo slot da janela 24h deslizante. O Claude NÃO é tocado (custo barrado).
  | { kind: 'limite_geracao'; retryAfterMs: number }

/**
 * Reconstrói o `{systemPrompt, userPrompt}` da predecessora pela `mode` da sua creation_session.
 * Devolve `null` quando a fonte é IRRECUPERÁVEL (transcrição apagada, briefing/free_text ausente)
 * — o caller mapeia para 409 sem_fonte (NUNCA 500). PURO em relação ao DB exceto pelas leituras
 * dos registros de proveniência.
 */
async function recoverPrompt(
  db: Database,
  session: { id: string; mode: string; briefingId: string | null; freeText: string | null },
): Promise<{ systemPrompt: string; userPrompt: string } | null> {
  if (session.mode === 'conversation') {
    // Reconstrói a Transcrição das falas duráveis (#15). Apagada (DELETE /transcript) → vazia →
    // irrecuperável (409, não 500): sem falas não há o que destilar.
    const rows = await db
      .select({ role: transcriptMessage.role, content: transcriptMessage.content })
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, session.id))
      .orderBy(asc(transcriptMessage.seq))
    if (rows.length === 0) return null
    const transcript: TranscriptMessage[] = rows.map((m) => ({ role: m.role, content: m.content }))
    return buildConversationPrompt(transcript)
  }

  if (session.mode === 'structured') {
    // Reconstrói o Briefing dos registros de proveniência (#11). briefing_id ausente (set-null) →
    // irrecuperável (409). Os itens vêm na ordem gravada.
    if (session.briefingId == null) return null
    const [b] = await db
      .select()
      .from(briefingTable)
      .where(eq(briefingTable.id, session.briefingId))
    if (!b) return null
    const itens = await db
      .select()
      .from(briefingItem)
      .where(eq(briefingItem.briefingId, session.briefingId))
      .orderBy(asc(briefingItem.ordem), asc(briefingItem.id))
    const briefing: Briefing = {
      cozinha: b.cozinha as Cozinha | null,
      // restricoes vem do pgEnum (já é Restricao[] válido no banco); o alargamento de tipo do
      // driver é estreitado aqui sem revalidar (o enum é a rede).
      restricoes: b.restricoes as Restricao[],
      porcoes: b.porcoes,
      dificuldade: b.dificuldade,
      observacoes: b.observacoes,
      itens: itens.map(
        (it): BriefingItem => ({
          ingredientId: it.ingredientId,
          rawText: it.rawText,
          quantidade: it.quantidade,
          unidade: it.unidade as Unidade | null,
          strength: it.strength,
        }),
      ),
    }
    return buildBriefingPrompt(briefing)
  }

  if (session.mode === 'free_text') {
    // Texto livre CRU gravado como proveniência (#88). Ausente/vazio → irrecuperável (409).
    if (session.freeText == null || session.freeText.trim() === '') return null
    return buildFreeTextPrompt(session.freeText)
  }

  return null
}

export async function regenerateRecipe(
  db: Database,
  claude: ClaudeClient,
  // `cap` (#167): teto numérico do papel do viewer, JÁ resolvido pelo caller (capFromRecipeGenConfig,
  // fonte ÚNICA). `Infinity` (admin/papel ilimitado) ⇒ pula a contagem. A regeneração persiste uma
  // `generation` que CONTA pro teto; sem este gate o usuário burlaria o cap pelo botão de regenerar.
  input: { recipeId: string; viewerId: string; model: string; cap: number },
): Promise<RegenerateResult> {
  const { recipeId, viewerId, model, cap } = input

  // ── GATE (1º toque de DB, ANTES do Claude) — owner + origin ──────────────────────
  const [pred] = await db
    .select({
      ownerId: recipe.ownerId,
      origin: recipe.origin,
      originalLocale: recipe.originalLocale,
      // #131: cozinha + image_id da predecessora — insumo do carry-forward + da comparação visual.
      cozinha: recipe.cozinha,
      imageId: recipe.imageId,
      // #222: lineage_id da predecessora — a nova versão HERDA (galeria compartilhada, ADR-0022).
      lineageId: recipe.lineageId,
    })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
  // Ausente OU não-própria (inclui catálogo owner_id NULL) → 404 leak-safe (NUNCA 403).
  if (!pred || pred.ownerId == null || pred.ownerId !== viewerId) return { kind: 'not_found' }
  // origin não-ai_* (catalog / user_edited) → sem prompt recuperável → 409 sem_fonte.
  if (!AI_ORIGINS.has(pred.origin)) return { kind: 'sem_fonte' }

  // A creation_session que ENTREGOU esta Receita (recipe_id = predecessora) — a posse já foi
  // provada acima. Sem sessão (ex. linha órfã) → 409 sem_fonte (não 500). Escopada por user_id
  // (defense-in-depth: nunca recupera prompt de sessão alheia).
  const [session] = await db
    .select({
      id: creationSession.id,
      mode: creationSession.mode,
      briefingId: creationSession.briefingId,
      freeText: creationSession.freeText,
    })
    .from(creationSession)
    .where(and(eq(creationSession.recipeId, recipeId), eq(creationSession.userId, viewerId)))
    .orderBy(asc(creationSession.createdAt))
    .limit(1)
  if (!session) return { kind: 'sem_fonte' }

  const prompt = await recoverPrompt(db, session)
  if (prompt === null) return { kind: 'sem_fonte' }

  // ── TETO de geração de RECEITA por papel (#167), janela 24h deslizante — ANTES do Claude ─────────
  // A posse + a fonte já foram provadas (mantém o not_found/sem_fonte primeiro, sem vazar o estado do
  // teto p/ Receitas alheias). A regeneração persiste uma `generation` na MESMA sessão, que CONTA pro
  // teto; sem este gate o usuário furaria o cap pelo botão de regenerar. cap ∞ (admin) pula a contagem.
  // Espelha o gate de POST /api/generations e de POST /api/conversations/stream.
  if (Number.isFinite(cap)) {
    const now = new Date()
    const recentAt = await loadRecentRecipeGenAt(db, viewerId, now)
    const quota = decideRecipeGenQuota({ cap, recentAt, now })
    if (!quota.allowed) return { kind: 'limite_geracao', retryAfterMs: quota.retryAfterMs }
  }

  // ── Claude (single-shot) → classify ──────────────────────────────────────────────
  // #318: constrange a cozinha da SAÍDA ao vocabulário VIVO (data-driven, ADR-0025). Conjunto
  // ATIVO do DB DIRETO (sem cache de escrita); a IA só re-emite cozinhas ativas na regeneração.
  const cozinhaSlugs = [...(await loadActiveCozinhaSlugs(db))]
  const out = await claude.generateRecipe({ systemPrompt: prompt.systemPrompt, userPrompt: prompt.userPrompt, model, cozinhaSlugs })
  const result = classify(out)

  // invalid: erro de sistema puro → NADA persiste (ADR-0006).
  if (result.outcome === 'invalid') return { kind: 'invalid' }

  // origin HERDADO da predecessora (PersistOrigin ai_*; o gate garantiu ai_*). O modo segue o da
  // sessão predecessora (irrelevante no caminho existingSessionId — não cria 2ª sessão).
  const origin = pred.origin as PersistOrigin

  if (result.outcome === 'impossible') {
    // impossible NÃO entrega Receita; persiste como episódio (generation na MESMA sessão).
    await persistGeneration({
      result,
      mode: session.mode as Parameters<typeof persistGeneration>[0]['mode'],
      origin,
      ownerId: viewerId,
      model,
      existingSessionId: session.id,
    })
    return { kind: 'impossible', advisory: result.advisory }
  }

  // success | degraded | playful → NOVA Receita imutável (lineage regenerated). #131: HERDA o
  // image_id da predecessora (carry-forward — mesmo blob, sem arquivo novo).
  const p = await persistGeneration({
    result,
    mode: session.mode as Parameters<typeof persistGeneration>[0]['mode'],
    origin,
    ownerId: viewerId,
    model,
    existingSessionId: session.id,
    lineage: { parentRecipeId: recipeId, lineageKind: 'regenerated' },
    imageId: pred.imageId,
    // #222: HERDA a lineage_id da predecessora ⇒ a nova versão compartilha a MESMA galeria (a face
    // carregada por carry-forward É membro dela — lineage_id da imagem == lineage_id compartilhada).
    lineageId: pred.lineageId,
  })
  // p é não-null para success/degraded/playful (persistGeneration só devolve null em invalid,
  // já tratado acima). recipeId presente nesse caminho.
  const newRecipeId = p?.recipeId
  if (newRecipeId == null) {
    // Defesa: nunca deveria ocorrer nesse caminho. Trata como erro de sistema (nada exibido).
    return { kind: 'invalid' }
  }

  // Wire a camada semântica da NOVA Receita (#14): re-embeda o locale original p/ entrar na Busca.
  // #119: best-effort (ASSISTIVO) — agora que o embedder é REAL (rede), um erro (sem key / 429 / rede)
  // NÃO pode derrubar a regeneração (a Receita já está persistida; a Busca degrada pra FTS+trigram).
  // Espelha os caminhos de criação (generations/conversation/derive).
  await embedTranslation(db, newRecipeId, result.recipe.originalLocale).catch(() => {})

  // #131: a nova versão herdou imagem? Compara o conjunto-de-ingredientes + título + cozinha da
  // predecessora contra a versão fresca; mudança VISUAL ⇒ sugere revisar a foto. Sem imagem
  // herdada ⇒ silencioso (não paga a leitura do snapshot do pai). PURO de comparação no domínio.
  let imageReviewSuggested = false
  if (pred.imageId != null) {
    imageReviewSuggested = shouldSuggestNewImage({
      hasImage: true,
      changed: visualChangesBetween(
        await loadParentSnapshot(db, recipeId, pred.originalLocale, pred.cozinha),
        {
          titulo: result.recipe.titulo,
          cozinha: result.recipe.cozinha,
          ingredientes: result.recipe.ingredientes.map((i) => i.rawText ?? ''),
        },
      ),
    })
  }

  return { kind: 'ok', outcome: result.outcome, recipeId: newRecipeId, advisory: result.advisory, imageReviewSuggested }
}

/**
 * Snapshot da PREDECESSORA p/ a comparação visual do #131: título (locale original) + cozinha +
 * rótulos de ingrediente (rawText, casando a convenção do diff de derive). Leituras pequenas nas
 * tabelas-filhas; só roda quando a predecessora tinha imagem (caminho que importa).
 */
async function loadParentSnapshot(
  db: Database,
  recipeId: string,
  originalLocale: string,
  cozinha: string | null,
): Promise<ImageReviewSnapshot> {
  const [titRow] = await db
    .select({ titulo: recipeTranslation.titulo })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, originalLocale)))
    .limit(1)
  const ingRows = await db
    .select({ rawText: recipeIngredient.rawText })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, recipeId))
  return {
    titulo: titRow?.titulo ?? '',
    cozinha,
    ingredientes: ingRows.map((i) => i.rawText ?? ''),
  }
}
