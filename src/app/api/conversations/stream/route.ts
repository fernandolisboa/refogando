import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { appConfig } from '@/db/schema'
import { classify } from '@/domain/generation'
import { parseTranscript } from '@/domain/transcript'
import {
  SYSTEM_PROMPT_DISTILLATION,
  buildConversationPrompt,
} from '@/domain/briefing'
import { decidePostGenerationRestrictionNotices } from '@/domain/recipe-restrictions'
import { renderAvisos } from '@/domain/recipe-read'
import { parseRequestLocale } from '@/server/http/params'
import { persistGeneration } from '@/server/generation/persist'

/**
 * Modo CONVERSA — streaming + destilação (issue #12, ADR-0009/0010).
 *
 * POST abre um ReadableStream NDJSON. Por que streaming (e não o 201/502 de
 * /api/generations): a UI mostra a conversa token-a-token e a Receita só nasce DEPOIS, da
 * destilação. Fluxo:
 *  1. requireSession → 401 JSON ANTES de abrir o stream (Anônimo-efêmero é #22, fora de
 *     escopo: a conversa exige Usuário logado, creation_session.user_id NOT NULL).
 *  2. parseTranscript(body.transcript) → 400 JSON ANTES de abrir o stream. O seam NUNCA é
 *     tocado com entrada inválida.
 *  3. body.sessionId é forward-compat: ACEITO e IGNORADO em #12 (retomada de sessão é #15).
 *  4. resolve `model` de app_config.default_model (default em código quando ausente).
 *  5. abre o stream: streamConversation() → frames {type:'token'} (ADR-0009, 1ª chamada);
 *     na conclusão do iterável, roda a DESTILAÇÃO (generateRecipe, 2ª chamada, VERBATIM) →
 *     classify → UM frame terminal.
 *
 * DUAS chamadas distintas ao Claude (ADR-0009): streamConversation (texto) e generateRecipe
 * (single-shot, structured output). A destilação reusa buildConversationPrompt(transcript).
 *
 * WIRE = NDJSON (Content-Type application/x-ndjson), uma união discriminada por linha:
 *  - zero-ou-mais {type:'token',text}
 *  - EXATAMENTE UM terminal:
 *      {type:'recipe',outcome,recipeId,advisory,avisos?}  (SUCCESS/DEGRADED/PLAYFUL — espelha
 *        o 201 de /api/generations; devolve recipeId, NÃO o corpo da Receita)
 *      {type:'impossible',advisory}                        (hard-stop honesto, sem Receita)
 *      {type:'error',error:'geracao_invalida'}             (INVALID)
 *
 * ASSIMETRIA DE TRANSPORTE (NÃO "consertar"): o caminho structured devolve HTTP 502 para
 * INVALID, mas aqui a destilação SEMPRE roda DEPOIS do stream abrir → os headers JÁ foram
 * enviados → INVALID NÃO pode usar status HTTP → é SEMPRE o frame in-band {type:'error'}.
 * Só as falhas PRÉ-stream (auth 401, shape 400) usam Response JSON normal.
 *
 * Aviso pós-geração (ADR-0004): só decidePostGenerationRestrictionNotices(receita destilada)
 * roda — NÃO há scan pré-geração de Briefing (a conversa não tem Briefing).
 */

export const runtime = 'nodejs' // SDK Anthropic + postgres-js exigem Node, não Edge.

const DEFAULT_MODEL = 'claude-opus-4-8'

// Frames do contrato NDJSON. O {type:'recipe'} espelha o 201 de /api/generations.
type TerminalFrame =
  | {
      type: 'recipe'
      outcome: 'success' | 'degraded' | 'playful'
      recipeId: string | null
      advisory: string | null
      avisos?: ReturnType<typeof renderAvisos>
    }
  | { type: 'impossible'; advisory: string | null }
  | { type: 'error'; error: 'geracao_invalida' }

const encoder = new TextEncoder()

// Cada linha é UM frame JSON, terminada por '\n'.
function ndjsonLine(frame: { type: 'token'; text: string } | TerminalFrame): Uint8Array {
  return encoder.encode(JSON.stringify(frame) + '\n')
}

export async function POST(req: Request): Promise<Response> {
  // 1. AUTH FAIL-CLOSED: 401 JSON ANTES de abrir o stream.
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as {
    transcript?: unknown
    sessionId?: unknown // forward-compat: aceito e IGNORADO em #12 (retomada é #15).
  }

  // 2. Shape da Transcrição: 400 JSON ANTES de abrir o stream (seam NUNCA tocado).
  const parsed = parseTranscript(body.transcript)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const transcript = parsed.transcript

  // 4. Modelo de app_config (default em código quando a linha singleton está ausente).
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_MODEL

  // requestLocale é lido AGORA (Request ainda disponível) — o Aviso é renderizado no locale.
  const requestLocale = parseRequestLocale(req)

  // 5. Abre o stream NDJSON: tokens primeiro, depois UM frame terminal, depois fecha.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 1ª chamada (ADR-0009): streama texto token-a-token.
        const tokens = getClaudeClient().streamConversation({
          systemPrompt: SYSTEM_PROMPT_DISTILLATION,
          transcript,
          model,
        })
        for await (const text of tokens) {
          controller.enqueue(ndjsonLine({ type: 'token', text }))
        }

        // 2ª chamada (ADR-0009): DESTILAÇÃO single-shot a partir da Transcrição (VERBATIM
        // o generateRecipe de #8). A estrutura nasce da SAÍDA do RecipeGenSchema.
        const prompt = buildConversationPrompt(transcript)
        const out = await getClaudeClient().generateRecipe({
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          model,
        })
        const result = classify(out)

        let terminal: TerminalFrame
        if (result.outcome === 'invalid') {
          // INVALID in-band (headers já enviados — NUNCA 502). NADA é persistido.
          terminal = { type: 'error', error: 'geracao_invalida' }
        } else if (result.outcome === 'impossible') {
          // Sem Receita, mas HÁ episódio de criação (creation_session + generation).
          await persistGeneration({ result, mode: 'conversation', origin: 'ai_chat', ownerId, model })
          terminal = { type: 'impossible', advisory: result.advisory }
        } else {
          // success | degraded | playful → Receita privada (origin ai_chat).
          const p = await persistGeneration({
            result,
            mode: 'conversation',
            origin: 'ai_chat',
            ownerId,
            model,
          })
          // Aviso pós-geração (#87/ADR-0004): só pós-geração (sem Briefing). Não-bloqueante.
          const postAvisos = decidePostGenerationRestrictionNotices({
            restricoes: result.recipe.restricoes,
            ingredientes: result.recipe.ingredientes,
          }).avisos
          const avisos = renderAvisos(postAvisos, requestLocale)
          const frame: TerminalFrame = {
            type: 'recipe',
            outcome: result.outcome,
            recipeId: p?.recipeId ?? null,
            advisory: result.advisory,
          }
          // Anexa `avisos` SÓ quando há contradição (ausente ≠ vazio — espelha o 201).
          if (avisos.length > 0) frame.avisos = avisos
          terminal = frame
        }

        controller.enqueue(ndjsonLine(terminal))
        controller.close()
      } catch (err) {
        // Erro durante o stream (ex.: seam estourou). Não há terminal: o cliente trata a
        // ausência de frame terminal como aviso/retomada (queda de stream). Erra o stream.
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
}
