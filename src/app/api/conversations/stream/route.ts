import { eq, sql } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { pgCode } from '@/server/recipe/visibility'
import { getDb, getClaudeClient } from '@/server/deps'
import { DEFAULT_CLAUDE_MODEL } from '@/server/claude/client'
import { appConfig, creationSession, transcriptMessage } from '@/db/schema'
import { classify } from '@/domain/generation'
import { parseTranscript, type TranscriptMessage } from '@/domain/transcript'
import {
  SYSTEM_PROMPT_DISTILLATION,
  buildConversationPrompt,
} from '@/domain/briefing'
import { decidePostGenerationRestrictionNotices } from '@/domain/recipe-restrictions'
import { renderAvisos } from '@/domain/recipe-read'
import { parseRequestLocale, isUuid } from '@/server/http/params'
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
 *  3. body.sessionId (#15): se VEM, RETOMA a Session (a Transcrição cresce nela e a Receita
 *     se anexa por UPDATE); se NÃO vem, a Session é criada PREGUIÇOSAMENTE (back-compat com o
 *     contrato stateless de #12). Cada chamada persiste EXATAMENTE 2 falas novas — a última do
 *     Usuário (o turno) + a resposta acumulada do Assistente — com `seq` monotônico atribuído
 *     pelo servidor (coalesce(max(seq),-1)+1 na mesma tx) e bumpa `updated_at`. Os turnos
 *     anteriores JÁ foram persistidos em chamadas passadas — NÃO se re-grava.
 *  4. resolve `model` de app_config.default_model (default em código quando ausente).
 *  5. abre o stream: streamConversation() → frames {type:'token'} (ADR-0009, 1ª chamada);
 *     na conclusão do iterável, PERSISTE as 2 falas novas, depois roda a DESTILAÇÃO
 *     (generateRecipe, 2ª chamada, VERBATIM) → classify → UM frame terminal. A Receita
 *     destilada se anexa à Session via `existingSessionId` (UPDATE de recipe_id).
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
 *      {type:'error',error:'conflito_concorrente'}         (corrida de append na MESMA Session
 *        bateu no UNIQUE(creation_session_id, seq) → 23505; frame limpo em vez de close mudo)
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
  | { type: 'error'; error: 'geracao_invalida' | 'conflito_concorrente' }

const encoder = new TextEncoder()

// Cada linha é UM frame JSON, terminada por '\n'.
function ndjsonLine(frame: { type: 'token'; text: string } | TerminalFrame): Uint8Array {
  return encoder.encode(JSON.stringify(frame) + '\n')
}

/**
 * #15 — resolve a Session do turno e PERSISTE as 2 falas novas, tudo numa ÚNICA transação:
 *  1. Resolve a Session: `incomingSessionId` só é REUSADO se existir E for do `ownerId`
 *     (posse fail-closed — não se escreve na Session de outro Usuário); caso contrário (ou
 *     ausente) cria uma nova (lazy-create, back-compat com o contrato stateless de #12).
 *  2. Anexa EXATAMENTE 2 falas: a ÚLTIMA do Usuário (o turno novo) + a resposta acumulada do
 *     Assistente — com `seq` monotônico do servidor (coalesce(max(seq),-1)+1 NA tx) e bumpa
 *     `updated_at` (last-activity, ADR-0006). Os turnos anteriores já foram gravados antes.
 *
 * O índice UNIQUE(creation_session_id, seq) é a rede contra dupla atribuição (23505).
 * Devolve o `sessionId` resolvido (threado em persistGeneration como existingSessionId).
 *
 * CONTRATO: roda numa ÚNICA transação (resolve a Session + anexa as 2 falas + bumpa
 * updated_at, tudo ou nada). O CHAMADOR detém o contrato de abort/posse — esta função NÃO
 * checa `signal.aborted` (o `start` faz isso antes de chamá-la) nem (re)autentica o caller.
 * Dois appends concorrentes na MESMA Session colidem no UNIQUE(creation_session_id, seq):
 * o perdedor estoura 23505, que o `start` traduz no frame terminal {type:'error',
 * error:'conflito_concorrente'} (sem auto-retry — fora de escopo).
 */
async function ensureSessionAndAppendTurn(input: {
  ownerId: string
  incomingSessionId: string | null
  userTurn: TranscriptMessage
  assistantText: string
}): Promise<string> {
  const { ownerId, incomingSessionId, userTurn, assistantText } = input
  const db = getDb()

  return db.transaction(async (tx) => {
    let sessionId: string
    if (incomingSessionId) {
      const [existing] = await tx
        .select({ id: creationSession.id, userId: creationSession.userId })
        .from(creationSession)
        .where(eq(creationSession.id, incomingSessionId))
      // Reusa só se for do próprio Usuário; senão lazy-create (não escreve em sessão alheia).
      sessionId = existing && existing.userId === ownerId ? existing.id : ''
    } else {
      sessionId = ''
    }

    if (sessionId === '') {
      const [created] = await tx
        .insert(creationSession)
        .values({ userId: ownerId, mode: 'conversation', recipeId: null })
        .returning({ id: creationSession.id })
      sessionId = created.id
    }

    // seq monotônico atribuído NA tx (nunca do cliente). 2 falas → seq base e base+1.
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${transcriptMessage.seq}), -1) + 1` })
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, sessionId))

    await tx.insert(transcriptMessage).values([
      { creationSessionId: sessionId, role: userTurn.role, content: userTurn.content, seq: next },
      { creationSessionId: sessionId, role: 'assistant', content: assistantText, seq: next + 1 },
    ])

    // Bumpa updated_at na MESMA tx (last-activity p/ TTL futuro — ADR-0006:7), mesmo que a
    // destilação ainda vá rodar depois (que tocará updated_at de novo no caminho de sucesso).
    await tx
      .update(creationSession)
      .set({ updatedAt: sql`now()` })
      .where(eq(creationSession.id, sessionId))

    return sessionId
  })
}

export async function POST(req: Request): Promise<Response> {
  // 1. AUTH FAIL-CLOSED: 401 JSON ANTES de abrir o stream.
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as {
    transcript?: unknown
    sessionId?: unknown // #15: retoma a Session quando presente (uuid); lazy-create quando ausente.
  }

  // 2. Shape da Transcrição: 400 JSON ANTES de abrir o stream (seam NUNCA tocado).
  const parsed = parseTranscript(body.transcript)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  const transcript = parsed.transcript

  // #15: sessionId só é honrado se for uuid válido; qualquer outra coisa cai no lazy-create
  // (a posse é re-checada na persistência — só o dono retoma a própria Session).
  const incomingSessionId = typeof body.sessionId === 'string' && isUuid(body.sessionId)
    ? body.sessionId
    : null

  // 4. Modelo de app_config (default em código quando a linha singleton está ausente).
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_CLAUDE_MODEL

  // Sinal de abort do request: em disconnect do cliente HTTP, o loop de tokens para e a
  // destilação é PULADA (não se queima quota gerando p/ um cliente que sumiu). Passa também
  // ao seam, para cancelar a chamada do SDK em voo. Backpressure: o stream de tokens é
  // limitado por max_tokens → não há buffering ilimitado p/ um cliente lento conectado; só o
  // disconnect importa, e o abort acima é o conserto correto e suficiente.
  const signal = req.signal

  // requestLocale é lido AGORA (Request ainda disponível) — o Aviso é renderizado no locale.
  const requestLocale = parseRequestLocale(req)

  // 5. Abre o stream NDJSON: tokens primeiro, depois UM frame terminal, depois fecha.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 1ª chamada (ADR-0009): streama texto token-a-token. Acumula a resposta do
        // Assistente p/ persistir como UMA fala (#15) depois que o stream completar.
        let assistantText = ''
        const tokens = getClaudeClient().streamConversation({
          systemPrompt: SYSTEM_PROMPT_DISTILLATION,
          transcript,
          model,
          signal,
        })
        for await (const text of tokens) {
          // Disconnect do cliente: para o loop ANTES de enfileirar. Sem cliente p/ receber, o
          // stream do seam é cancelado (via `signal`) e a destilação é pulada — nada persiste.
          if (signal.aborted) return
          assistantText += text
          controller.enqueue(ndjsonLine({ type: 'token', text }))
        }

        // Aborts MID-stream já foram tratados pelo early-return DENTRO do loop de tokens
        // acima. Este check pós-loop guarda o que vem DEPOIS: o append da Transcrição, a
        // destilação (2ª chamada ao Claude) e a persistência — nada disso roda se o cliente
        // sumiu (sem cliente p/ receber o frame terminal; nada de Transcrição persiste).
        if (signal.aborted) return

        // #15: PERSISTE as 2 falas novas (turno do Usuário + resposta do Assistente) e resolve
        // a Session (retoma a `incomingSessionId` do dono, ou cria preguiçosamente). A última
        // fala do transcript é GARANTIDAMENTE do Usuário (parseTranscript). Daqui pra frente,
        // `sessionId` é threado na destilação como existingSessionId (anexa a Receita por UPDATE).
        const sessionId = await ensureSessionAndAppendTurn({
          ownerId,
          incomingSessionId,
          userTurn: transcript[transcript.length - 1],
          assistantText,
        })

        // Abortado DURANTE o append (cliente sumiu enquanto a tx rodava): não queima a 2ª
        // chamada ao Claude (destilação). As 2 falas já commitadas são o turno real e ficam
        // — a retomada re-destila a partir delas. (Espelha o pre-append abort acima.)
        if (signal.aborted) return

        // 2ª chamada (ADR-0009): DESTILAÇÃO single-shot a partir da Transcrição (VERBATIM
        // o generateRecipe de #8). A estrutura nasce da SAÍDA do RecipeGenSchema.
        const prompt = buildConversationPrompt(transcript)
        const out = await getClaudeClient().generateRecipe({
          systemPrompt: prompt.systemPrompt,
          userPrompt: prompt.userPrompt,
          model,
          signal,
        })
        const result = classify(out)

        let terminal: TerminalFrame
        if (result.outcome === 'invalid') {
          // INVALID in-band (headers já enviados — NUNCA 502). NENHUMA generation/Receita é
          // persistida (erro de sistema puro não é episódio de criação — ADR-0006); a Session
          // e a Transcrição do turno JÁ foram gravadas acima (a conversa aconteceu — só a
          // destilação falhou; o Usuário pode tentar de novo na mesma Session).
          terminal = { type: 'error', error: 'geracao_invalida' }
        } else if (result.outcome === 'impossible') {
          // Sem Receita, mas HÁ episódio de criação. RETOMA a Session (#15): só bumpa
          // updated_at (recipe_id segue NULL) + insere a generation — NÃO cria 2ª Session.
          await persistGeneration({
            result,
            mode: 'conversation',
            origin: 'ai_chat',
            ownerId,
            model,
            existingSessionId: sessionId,
          })
          terminal = { type: 'impossible', advisory: result.advisory }
        } else {
          // success | degraded | playful → Receita privada (origin ai_chat). RETOMA a Session
          // (#15): anexa a Receita por UPDATE de recipe_id + insere a generation.
          const p = await persistGeneration({
            result,
            mode: 'conversation',
            origin: 'ai_chat',
            ownerId,
            model,
            existingSessionId: sessionId,
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
        // Abort do cliente em voo (o seam estoura com AbortError): não é falha real, é
        // disconnect — não loga como erro nem tenta sinalizar um cliente que já sumiu.
        if (signal.aborted) return
        // Corrida de append na MESMA Session: dois requests concorrentes batem no UNIQUE
        // (creation_session_id, seq) → 23505. Em vez de um close MUDO (que o cliente lê como
        // queda de stream ambígua), emite um frame terminal LIMPO e determinístico e fecha.
        // NÃO há auto-retry (fora de escopo — o cliente decide se reenvia o turno).
        if (pgCode(err) === '23505') {
          controller.enqueue(ndjsonLine({ type: 'error', error: 'conflito_concorrente' }))
          controller.close()
          return
        }
        // Erro durante o stream (ex.: seam estourou). Loga no servidor ANTES de errar o
        // stream — sem isso a falha é invisível em produção. Sanitizado: tag + mensagem/stack,
        // NUNCA a API key, nem o conteúdo da Transcrição.
        console.error('[conversations/stream] falha no stream:', err)
        // Não há terminal: o cliente trata a ausência de frame terminal como aviso/retomada
        // (queda de stream). Erra o stream.
        controller.error(err)
      }
    },
    cancel() {
      // Cliente desconectou (cancelou a leitura do stream). `req.signal` já está abortado; o
      // loop em `start` checa `signal.aborted` e o seam recebe o `signal`, então o trabalho do
      // LLM para e a destilação é pulada. Nada a fazer aqui além de honrar o cancelamento.
    },
  })

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  })
}
