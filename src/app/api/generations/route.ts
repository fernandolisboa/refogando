import { inArray } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { appConfig, ingredient } from '@/db/schema'
import { isCreationMode } from '@/domain/recipe'
import { isPorcoesValidas, isDificuldadeValida } from '@/domain/vocabulary'
import { classify } from '@/domain/generation'
import {
  parseBriefing,
  buildBriefingPrompt,
  briefingItemsParaAviso,
  type Briefing,
} from '@/domain/briefing'
import { decideRestrictionNotices } from '@/domain/recipe-restrictions'
import { renderAvisos } from '@/domain/recipe-read'
import { parseRequestLocale, isUuid } from '@/server/http/params'
import { persistGeneration, type PersistBriefing } from '@/server/generation/persist'

/**
 * Geração por IA — rota base do contrato (issue #8, §7a; ADR-0010 route handler).
 *
 * POST cria uma tentativa de geração. Fluxo: requireSession (401 Visitante) →
 * valida `mode` + entrada do usuário ANTES do seam (400, o cliente do Claude NUNCA
 * é chamado nesses casos) → resolve `model` de `app_config.default_model` → chama o
 * seam mockável → `classify` → persiste conforme a taxonomia.
 *
 * Status: success|degraded|playful → 201 (Receita privada criada); impossible → 200
 * (hard-stop honesto, sem Receita); invalid → 502 (falha upstream, NÃO persiste nada).
 *
 * Dois modos de ENTRADA (#11/#12):
 *  - `conversation`: caminho de #8 — placeholders + faixas top-level do body.
 *  - `structured`: monta um Briefing ANINHADO (`body.briefing`) e gera no MESMO
 *    `RecipeGenSchema` de saída — #11 muda só a ENTRADA. O Briefing é validado
 *    (shape + faixas + campo-mínimo) ANTES do seam, persistido como proveniência
 *    (o PEDIDO), e gera o Aviso (#7) anexado INLINE, não-bloqueante, no 201.
 */

export const runtime = 'nodejs' // SDK Anthropic + postgres-js exigem Node, não Edge.

const DEFAULT_MODEL = 'claude-opus-4-8'

// Placeholder mínimo do caminho `conversation` (#12 substitui pelo prompt de verdade).
// `structured` monta o prompt a partir do Briefing (buildBriefingPrompt).
const SYSTEM_PROMPT = 'Você gera receitas de cozinha no schema canônico.'
const USER_PROMPT = 'Gere uma receita.'

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown
    porcoes?: unknown
    dificuldade?: unknown
    briefing?: unknown
  }

  // mode obrigatório + válido.
  if (typeof body.mode !== 'string' || !isCreationMode(body.mode)) {
    return Response.json({ error: 'modo_invalido' }, { status: 400 })
  }
  const mode = body.mode

  // Prompt + Briefing montado: dependem do modo. `briefing` só existe em structured.
  let systemPrompt = SYSTEM_PROMPT
  let userPrompt = USER_PROMPT
  let briefing: Briefing | null = null
  // Mapa alérgenos-por-ingrediente: subproduto do SELECT antecipado (structured), usado
  // no Aviso (§4.4). Vazio em conversation.
  const alergMap = new Map<string, string[] | null>()

  if (mode === 'structured') {
    // a. Valida shape + faixas + campo-mínimo do Briefing — TUDO antes do seam. O dedup
    //    silencioso já está aplicado dentro de parseBriefing.
    const parsed = parseBriefing(body.briefing)
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
    briefing = parsed.briefing

    // c. SELECT em `ingredient` pelos ingredientId não-null do briefing, ANTES do seam.
    //    Serve a DOIS propósitos (um único toque de DB): (i) VALIDAR EXISTÊNCIA — se
    //    algum ingredientId bem-formado não resolver linha → 400 ingrediente_inexistente,
    //    o seam NUNCA é tocado; (ii) montar o mapa de alérgenos para o Aviso (§3.8/§4.4).
    const ingIds = [
      ...new Set(
        briefing.itens
          .map((it) => it.ingredientId)
          .filter((x): x is string => x != null),
      ),
    ]
    // Guard de forma ANTES de tocar a coluna uuid: um ingredientId malformado (parseBriefing
    //    só checa `typeof === 'string'`) faria o Postgres lançar 22P02 (500 / vazamento de SQL)
    //    no inArray. Malformado é indistinguível de inexistente para o cliente → mesma política
    //    not_found dos handlers [id] (params.ts). O seam NUNCA é tocado.
    if (ingIds.some((id) => !isUuid(id))) {
      return Response.json({ error: 'ingrediente_inexistente' }, { status: 400 })
    }
    if (ingIds.length > 0) {
      const rows = await getDb()
        .select({ id: ingredient.id, alergenos: ingredient.alergenos })
        .from(ingredient)
        .where(inArray(ingredient.id, ingIds))
      if (rows.length !== ingIds.length) {
        return Response.json({ error: 'ingrediente_inexistente' }, { status: 400 })
      }
      for (const row of rows) alergMap.set(row.id, row.alergenos)
    }

    // d. Monta {systemPrompt, userPrompt} a partir do Briefing (substitui placeholders).
    const prompt = buildBriefingPrompt(briefing)
    systemPrompt = prompt.systemPrompt
    userPrompt = prompt.userPrompt
  } else {
    // conversation (#12): faixas do TOPO do body, ANTES do seam (E6 — em structured o
    // topo é IGNORADO; as faixas vivem dentro do briefing).
    if (
      body.porcoes != null &&
      (typeof body.porcoes !== 'number' || !isPorcoesValidas(body.porcoes))
    ) {
      return Response.json({ error: 'porcoes_fora_de_faixa' }, { status: 400 })
    }
    if (
      body.dificuldade != null &&
      (typeof body.dificuldade !== 'number' || !isDificuldadeValida(body.dificuldade))
    ) {
      return Response.json({ error: 'dificuldade_fora_de_faixa' }, { status: 400 })
    }
  }

  // Modelo de app_config (default em código quando a linha singleton está ausente).
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_MODEL
  const origin = mode === 'conversation' ? 'ai_chat' : 'ai_structured'

  const out = await getClaudeClient().generateRecipe({
    systemPrompt,
    userPrompt,
    model,
  })
  const result = classify(out)

  // Erro de sistema puro: NÃO persiste nada (sem creation_session/generation/recipe/briefing).
  if (result.outcome === 'invalid') {
    return Response.json({ outcome: 'invalid', error: 'geracao_invalida' }, { status: 502 })
  }

  // O Briefing (o PEDIDO) é persistido como proveniência mesmo quando a entrega é
  // impossible (AC4): tabelas separadas da Receita, a sessão aponta para AMBOS.
  const persistBriefing: PersistBriefing | undefined = briefing
    ? {
        cozinha: briefing.cozinha,
        restricoes: briefing.restricoes,
        porcoes: briefing.porcoes,
        dificuldade: briefing.dificuldade,
        observacoes: briefing.observacoes,
        itens: briefing.itens.map((it, index) => ({
          ingredientId: it.ingredientId,
          rawText: it.rawText,
          quantidade: it.quantidade,
          unidade: it.unidade,
          strength: it.strength,
          ordem: index,
        })),
      }
    : undefined

  if (result.outcome === 'impossible') {
    // Impossible NÃO carrega Aviso (§4.4/E7): sem Receita entregue, não há Aviso.
    await persistGeneration({ result, mode, origin, ownerId, model, briefing: persistBriefing })
    return Response.json({ outcome: 'impossible', advisory: result.advisory }, { status: 200 })
  }

  // success | degraded | playful → Receita privada + generation.
  const p = await persistGeneration({
    result,
    mode,
    origin,
    ownerId,
    model,
    briefing: persistBriefing,
  })

  // Aviso INLINE, não-bloqueante (#7), SÓ no 201 com Receita entregue (§4.4). Decidido
  // sobre o BRIEFING (o pedido); a Receita persiste independentemente. Anexa `avisos`
  // SÓ quando há contradição (ausente ≠ vazio — espelha a vista #7).
  const responseBody: {
    outcome: typeof result.outcome
    recipeId: string | null
    advisory: string | null
    avisos?: ReturnType<typeof renderAvisos>
  } = {
    outcome: result.outcome,
    recipeId: p?.recipeId ?? null,
    advisory: result.advisory,
  }
  if (briefing) {
    const decision = decideRestrictionNotices({
      restricoes: briefing.restricoes,
      items: briefingItemsParaAviso(briefing.itens, alergMap),
    })
    const avisos = renderAvisos(decision.avisos, parseRequestLocale(req))
    if (avisos.length > 0) responseBody.avisos = avisos
  }

  return Response.json(responseBody, { status: 201 })
}
