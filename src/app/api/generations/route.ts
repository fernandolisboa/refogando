import { inArray } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { DEFAULT_CLAUDE_MODEL } from '@/server/claude/client'
import { appConfig, ingredient } from '@/db/schema'
import { isCreationMode } from '@/domain/recipe'
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { suggestCozinha } from '@/server/vocabulary/suggest'
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
import { loadRecentRecipeGenAt } from '@/server/generation/quota'
import {
  capFromRecipeGenConfig,
  DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
} from '@/domain/recipe-gen-config'
import { decideRecipeGenQuota } from '@/domain/recipe-gen-quota'

/**
 * Geração por IA — rota base do contrato (issue #8, §7a; ADR-0010 route handler).
 *
 * POST cria uma tentativa de geração. Fluxo: requireSession (401 Visitante) →
 * valida `mode` + entrada do usuário ANTES do seam (400, o cliente do Claude NUNCA
 * é chamado nesses casos) → resolve `model` de `app_config.default_model` → TETO de geração
 * por papel (#167) → chama o seam mockável → `classify` → persiste conforme a taxonomia.
 *
 * Teto diário de geração de RECEITA por papel (#167, espelha o teto de imagem da #132/#134): ANTES
 * de tocar o Claude, conta as `generation` do usuário na janela 24h deslizante (sem ledger novo —
 * via creation_session.user_id) e decide pela função pura `decideRecipeGenQuota`. Estourou ⇒ 429
 * `limite_geracao` com `retryAfterMs` (countdown), o seam NÃO é tocado (custo barrado). cap ∞
 * (admin/papel ilimitado) pula a query de contagem.
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

// #191 (ADR-0021): geração `structured`/`free_text` é bloqueante (~8–15s, opus). Sem
// `maxDuration`, o default de 10s do Vercel Hobby pode matar uma chamada longa e devolvê-la
// como erro neutro ambíguo. 60s dá folga. Reversível (dica de plataforma, não regra de domínio).
export const maxDuration = 60

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
    // "Outra" (#319, ADR-0025 Decisão 5): cozinha livre escolhida na AUTORIA structured. Top-level
    // (NÃO dentro do briefing — `briefing.cozinha` fica null, validada contra o conjunto ativo).
    cozinhaOutra?: unknown
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

  // Conjunto ATIVO de cozinhas, DATA-DRIVEN do DB DIRETO (#318, ADR-0025 Decisão 4, sem cache de
  // leitura). HOISTED p/ FORA do ramo structured (carregado UMA vez): serve a parseBriefing (valida
  // a cozinha do PEDIDO) E à chamada constrita generateRecipe abaixo (constrange a SAÍDA da IA ao
  // vocabulário VIVO) — inclusive em `free_text`, que não valida Briefing mas precisa do constraint.
  // Pós-virada #318 NÃO há mais enum-bounding: 'americana' (ativa) é storável/gerável; o conjunto é
  // o slug-set CRU. Um único toque de DB (não duplica entre os modos).
  const activeCozinhas = await loadActiveCozinhaSlugs(getDb())

  // "Outra" (#319, ADR-0025 Decisão 5): slug `suggested` materializado pós-validação do briefing.
  // HOISTED p/ FORA do ramo structured (escopo de função) — o stamp pós-geração (no ponto de persist
  // compartilhado) precisa enxergá-lo. Fica null nos demais modos (free_text não tem briefing).
  let suggested: string | null = null

  if (mode === 'structured') {
    // a. Valida shape + faixas + campo-mínimo do Briefing — TUDO antes do seam. O dedup
    //    silencioso já está aplicado dentro de parseBriefing. Cozinha é DATA-DRIVEN (#318): o
    //    conjunto ATIVO (já carregado acima) vem do DB DIRETO — uma cozinha ativa qualquer
    //    (inclusive 'americana') é aceita; só slug NÃO-ativo vira 400 cozinha_invalida.
    const parsed = parseBriefing(body.briefing, activeCozinhas)
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
    briefing = parsed.briefing

    // "Outra" (#319, ADR-0025 Decisão 5): o usuário pediu uma cozinha fora do vocabulário ativo.
    // `briefing.cozinha` veio null (parseBriefing rejeitaria texto livre), então o servidor
    // materializa o slug `suggested` (dedup-na-entrada) e o injeta no briefing — assim ele vira a
    // cozinha do PEDIDO (proveniência, FK-válida) e o prompt abaixo já pede essa cozinha. A IA NUNCA
    // a inventa: o `z.enum` de geração segue só os ATIVOS; o servidor estampa o slug pós-geração.
    if (typeof body.cozinhaOutra === 'string' && body.cozinhaOutra.trim() !== '') {
      suggested = await suggestCozinha(getDb(), body.cozinhaOutra, ownerId)
      if (suggested != null) briefing = { ...briefing, cozinha: suggested }
    }

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

  // Config de app_config (default em código quando a linha singleton está ausente). UM toque de DB
  // serve ao modelo (#5) E ao teto de geração de receita (#167) — a linha singleton carrega ambos.
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_CLAUDE_MODEL

  // Teto de geração de RECEITA por papel (#167), janela 24h deslizante — ANTES de tocar o Claude
  // (custo). cap ∞ (admin/papel ilimitado) pula a contagem. Estourou ⇒ 429 com countdown, mensagem
  // AMIGÁVEL mapeada pela UI (limite_geracao). Espelha o teto de imagem (#132/#134).
  const capByRole = cfg?.recipeGenCapByRole ?? DEFAULT_RECIPE_GEN_CAP_BY_ROLE
  const cap = capFromRecipeGenConfig(capByRole, g.session.user.role)
  if (Number.isFinite(cap)) {
    const now = new Date()
    const recentAt = await loadRecentRecipeGenAt(getDb(), ownerId, now)
    const quota = decideRecipeGenQuota({ cap, recentAt, now })
    if (!quota.allowed) {
      return Response.json(
        { error: 'limite_geracao', retryAfterMs: quota.retryAfterMs },
        { status: 429 },
      )
    }
  }

  // origin por modo (#88): conversation já foi rejeitado acima (vive na rota de stream), então
  // só restam free_text → ai_free_text e structured → ai_structured.
  const origin: PersistOrigin = mode === 'free_text' ? 'ai_free_text' : 'ai_structured'

  const out = await getClaudeClient().generateRecipe({
    systemPrompt,
    userPrompt,
    model,
    // #318: constrange a cozinha da SAÍDA structured ao vocabulário VIVO (data-driven). Mesmo
    // conjunto ATIVO hoisted acima — vale p/ structured E free_text (a IA só emite cozinhas vivas).
    cozinhaSlugs: [...activeCozinhas],
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

  // "Outra" (#319, ADR-0025 Decisão 5): a IA emitiu `cozinha=null` (o slug `suggested` não está no
  // `z.enum` dos ativos); o SERVIDOR estampa o slug pós-geração na Receita ENTREGUE. Só aqui (com
  // Receita) — o ramo `impossible` retorna acima sem `result.recipe`. `briefing.cozinha=suggested`
  // já flui via persistBriefing. A FK valida (a linha `suggested` existe); a contenção mantém o
  // termo invisível em superfície pública até o Curador aprovar (#320). Publicar NÃO é bloqueado.
  if (suggested != null) result.recipe.cozinha = suggested

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

  // #119: embeda a Receita recém-criada (best-effort, ASSISTIVO) p/ a Busca semântica achá-la pelo
  // SIGNIFICADO. Falha (sem key / 429 / rede) NÃO derruba a criação — a Receita já está persistida; a
  // Busca apenas degrada pra FTS+trigram (mesmo comportamento de hoje). Espelha ensureTranslation.
  if (p?.recipeId) {
    await embedTranslation(getDb(), p.recipeId, result.recipe.originalLocale).catch(() => {})
  }

  // Aviso INLINE, não-bloqueante (#7/#87), SÓ no 201 com Receita entregue (§4.4). A
  // Receita persiste independentemente. Anexa `avisos` SÓ quando há contradição (ausente ≠
  // vazio — espelha a vista #7).
  const responseBody: {
    outcome: typeof result.outcome
    recipeId: string | null
    advisory: string | null
    avisos?: ReturnType<typeof renderAvisos>
    // #231 (ADR-0020): slug + locale CONGELADOS na criação (do `persistGeneration`/#229), pro cliente
    // montar o link canônico `/{locale}/recipes/<slug>` SEM um 2º GET. "ausente ≠ vazio": só quando a
    // persistência os devolveu (caminho com Receita) — o cliente cai no fallback por UUID se faltarem.
    slug?: string
    locale?: string
  } = {
    outcome: result.outcome,
    recipeId: p?.recipeId ?? null,
    advisory: result.advisory,
    ...(p?.slug != null ? { slug: p.slug } : {}),
    ...(p?.locale != null ? { locale: p.locale } : {}),
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
