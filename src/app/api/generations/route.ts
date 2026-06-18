import { inArray } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { appConfig, ingredient } from '@/db/schema'
import { isCreationMode } from '@/domain/recipe'
import { classify } from '@/domain/generation'
import {
  parseBriefing,
  buildBriefingPrompt,
  buildFreeTextPrompt,
  briefingItemsParaAviso,
  OBSERVACOES_MAX,
  type Briefing,
} from '@/domain/briefing'
import {
  decideRestrictionNotices,
  decidePostGenerationRestrictionNotices,
  type RestrictionNotice,
} from '@/domain/recipe-restrictions'
import { renderAvisos } from '@/domain/recipe-read'
import { parseRequestLocale, isUuid } from '@/server/http/params'
import {
  persistGeneration,
  type PersistBriefing,
  type PersistOrigin,
} from '@/server/generation/persist'

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
 * Dois modos de ENTRADA tratados AQUI (#11/#88). O modo `conversation` (#12) NÃO vive
 * mais aqui: ele STREAMA NDJSON e roda a destilação DEPOIS de abrir o stream (não cabe num
 * 201/502 com headers já enviados), então mudou-se para POST /api/conversations/stream.
 * Esta rota dá um 400 `modo_invalido` explícito para `conversation` (sem cair no seam):
 *  - `structured`: monta um Briefing ANINHADO (`body.briefing`) e gera no MESMO
 *    `RecipeGenSchema` de saída — #11 muda só a ENTRADA. O Briefing é validado
 *    (shape + faixas + campo-mínimo) ANTES do seam, persistido como proveniência
 *    (o PEDIDO), e gera o Aviso (#7) anexado INLINE, não-bloqueante, no 201.
 *  - `free_text` (#88): texto livre (`body.freeText`) vai praticamente CRU como
 *    userPrompt (NÃO pré-parseado num Briefing); a estrutura nasce da SAÍDA do
 *    schema canônico. Valida não-vazio/comprimento ANTES do seam; persiste o texto
 *    cru como proveniência (creation_session.free_text, sem briefing).
 *
 * Aviso (#7/#87): o 201 anexa `avisos` INLINE, não-bloqueante. A UNIÃO determinística
 * combina o PRÉ-geração (do Briefing, SÓ structured) com o PÓS-geração (#87, da RECEITA
 * GERADA, em TODOS os modos), nessa ordem, deduplicando por restrição.
 */

export const runtime = 'nodejs' // SDK Anthropic + postgres-js exigem Node, não Edge.

const DEFAULT_MODEL = 'claude-opus-4-8'

// Faixa de comprimento do texto livre (#88, decisão reversível). A validação roda ANTES
// do seam, em AMBAS as bordas:
//  - MIN: recusa o que é curto demais para gerar (vazio, espaços, uma palavra solta).
//  - MAX: teto SIMÉTRICO ao OBSERVACOES_MAX=2000 do caminho structured. Sem ele, o texto
//    livre iria CRU pro userPrompt (custo de token ilimitado) e pra coluna text não-limitada
//    de creation_session.free_text (abuso de armazenamento) — Next.js App Router não limita o
//    tamanho de req.json() por padrão. O caractere é o limite real; o overhead do JSON é
//    proporcional a ele.
const MIN_FREE_TEXT_LENGTH = 10
const MAX_FREE_TEXT_LENGTH = OBSERVACOES_MAX

export async function POST(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const body = (await req.json().catch(() => ({}))) as {
    mode?: unknown
    briefing?: unknown
    freeText?: unknown
  }

  // mode obrigatório + válido.
  if (typeof body.mode !== 'string' || !isCreationMode(body.mode)) {
    return Response.json({ error: 'modo_invalido' }, { status: 400 })
  }
  const mode = body.mode

  // conversation (#12) NÃO é tratado aqui: streaming/destilação vivem em
  // POST /api/conversations/stream. 400 determinístico ANTES do seam (sem cair no Claude).
  if (mode === 'conversation') {
    return Response.json({ error: 'modo_invalido' }, { status: 400 })
  }

  // Prompt + Briefing montado: dependem do modo. `briefing` só existe em structured. Ambos
  // os modos restantes (structured/free_text) sempre atribuem os dois prompts.
  let systemPrompt = ''
  let userPrompt = ''
  let briefing: Briefing | null = null
  // Texto livre CRU (#88): definido SÓ em free_text; persistido como proveniência.
  let freeText: string | undefined
  // Mapa alérgenos-por-ingrediente: subproduto do SELECT antecipado (structured), usado
  // no Aviso (§4.4). Vazio em free_text.
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
  } else if (mode === 'free_text') {
    // free_text (#88): valida o texto livre ANTES do seam — o seam NUNCA é tocado nesses
    // casos. NÃO pré-parseia num Briefing (decisão de design): o texto vai praticamente CRU
    // como userPrompt; a estrutura nasce da SAÍDA do schema canônico e a segurança vem do
    // Aviso pós-geração (#87). `briefing` segue null. Duas bordas (sobre o texto trimado):
    //  - não-string OU curto demais → 400 free_text_vazio.
    //  - longo demais (> MAX, simétrico ao structured) → 400 free_text_muito_longo. Sem este
    //    teto, custo de token e armazenamento ficariam ilimitados (req.json() sem limite).
    if (typeof body.freeText !== 'string' || body.freeText.trim().length < MIN_FREE_TEXT_LENGTH) {
      return Response.json({ error: 'free_text_vazio' }, { status: 400 })
    }
    if (body.freeText.trim().length > MAX_FREE_TEXT_LENGTH) {
      return Response.json({ error: 'free_text_muito_longo' }, { status: 400 })
    }
    freeText = body.freeText.trim()
    const prompt = buildFreeTextPrompt(freeText)
    systemPrompt = prompt.systemPrompt
    userPrompt = prompt.userPrompt
  }

  // Modelo de app_config (default em código quando a linha singleton está ausente).
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_MODEL
  // origin por modo (#88): conversation já foi rejeitado acima (vive na rota de stream), então
  // só restam free_text → ai_free_text e structured → ai_structured.
  const origin: PersistOrigin = mode === 'free_text' ? 'ai_free_text' : 'ai_structured'

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
    await persistGeneration({ result, mode, origin, ownerId, model, briefing: persistBriefing, freeText })
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
    freeText,
  })

  // Aviso INLINE, não-bloqueante (#7/#87), SÓ no 201 com Receita entregue (§4.4). A
  // Receita persiste independentemente. Anexa `avisos` SÓ quando há contradição (ausente ≠
  // vazio — espelha a vista #7).
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

  // UNIÃO determinística (todos os modos): PRÉ-geração (do Briefing — SÓ structured, do
  // PEDIDO) PRIMEIRO, depois PÓS-geração (#87 — da RECEITA GERADA, em TODOS os modos),
  // dedup por restrição MANTENDO A PRIMEIRA ocorrência. Ordem fixa garante determinismo
  // quando ambas as fontes contradizem a MESMA restrição com tokens diferentes (o token
  // do PEDIDO/pré-geração vence). post-gen escaneia o que o LLM ENTREGOU; pre-gen, o pedido.
  const preAvisos: RestrictionNotice[] = briefing
    ? decideRestrictionNotices({
        restricoes: briefing.restricoes,
        items: briefingItemsParaAviso(briefing.itens, alergMap),
      }).avisos
    : []
  const postAvisos = decidePostGenerationRestrictionNotices({
    restricoes: result.recipe.restricoes,
    ingredientes: result.recipe.ingredientes,
  }).avisos
  const vistas = new Set<string>()
  const combinados: RestrictionNotice[] = []
  for (const aviso of [...preAvisos, ...postAvisos]) {
    if (vistas.has(aviso.restricao)) continue
    vistas.add(aviso.restricao)
    combinados.push(aviso)
  }
  const avisos = renderAvisos(combinados, parseRequestLocale(req))
  if (avisos.length > 0) responseBody.avisos = avisos

  return Response.json(responseBody, { status: 201 })
}
