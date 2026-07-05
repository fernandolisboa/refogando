import { eq, inArray } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb, getClaudeClient } from '@/server/deps'
import { embedTranslation } from '@/server/embedding/recompute'
import { DEFAULT_CLAUDE_MODEL } from '@/server/claude/client'
import { appConfig, ingredient, users } from '@/db/schema'
import { isCreationMode } from '@/domain/recipe'
import { loadActiveCozinhaSlugs, loadCozinhaVoice } from '@/server/vocabulary/active-set'
import { suggestCozinha, cozinhaSlugFromText, COZINHA_OUTRA_MAX } from '@/server/vocabulary/suggest'
import { classify, classifyVariants } from '@/domain/generation'
import {
  parseBriefing,
  buildBriefingPrompt,
  buildFreeTextPrompt,
  briefingItemsParaAviso,
  promptStampFor,
  resolveNivelChefAxis,
  resolveVozCozinhaAxis,
  isNivelChef,
  OBSERVACOES_MAX,
  type Briefing,
  type NivelChef,
  type PromptAxes,
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
import {
  parseRecipeVariantConfig,
  DEFAULT_RECIPE_VARIANT_CONFIG,
  type RecipeVariantConfig,
} from '@/domain/recipe-variant-config'
import { decideRecipeGenQuota } from '@/domain/recipe-gen-quota'
import { QuotaExceededError } from '@/server/quota/atomic'

/**
 * Helper PURO da borda (#423, Regra C do contrato de eixos ADR-0029): resolve o eixo `variacaoDivergente`
 * a partir da config de variação. Devolve `{ variacaoDivergente }` (config ligada) ou `{}` — cada
 * resolveX devolvendo {} colapsa a borda p/ NEUTRAL_AXES byte-a-byte no SPREAD ADITIVO. Assim outra fatia
 * só ACRESCENTA `...resolveDela(...)` numa sublinha própria, sem reescrever a montagem monolítica.
 */
function resolveVariacaoAxis(
  cfg: RecipeVariantConfig | null,
): Pick<PromptAxes, 'variacaoDivergente'> | Record<string, never> {
  if (cfg == null || !cfg.enabled) return {}
  return { variacaoDivergente: { poloA: cfg.poloA, poloB: cfg.poloB, instrucao: cfg.instrucao } }
}

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
    // Nível de habilidade (#421, ADR-0029 dec.2): override do eixo escolhido na geração structured.
    // TOP-LEVEL (irmão de `cozinhaOutra`, NÃO dentro do briefing). Ausente/ inválido ⇒ cai no default
    // do Perfil. Ignorado em free_text (que não tem seletor — só o default do Perfil vale lá).
    nivel?: unknown
    // #423: opt-in "Gerar 2 versões". `true` + config ligada + modo structured ⇒ caminho de variação.
    variar2?: unknown
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

  // Config de app_config (default em código quando a linha singleton está ausente). UM toque de DB serve
  // ao modelo (#5), ao teto de geração (#167) E à config de variação (#423). Carregada AQUI (ANTES dos
  // prompts) porque o eixo de variação molda o systemPrompt via buildSystemPrompt.
  const [cfg] = await getDb().select().from(appConfig)
  const model = cfg?.defaultModel ?? DEFAULT_CLAUDE_MODEL
  // #423: re-valida a config de variação na leitura (fail-safe, espelha loadAppConfig) — linha
  // editada à mão com pólo/instrução vazios cai no DEFAULT, nunca compõe um fragmento sem norte.
  const parsedVariant = parseRecipeVariantConfig(cfg?.recipeVariantConfig)
  const recipeVariantCfg = parsedVariant.ok ? parsedVariant.value : DEFAULT_RECIPE_VARIANT_CONFIG

  // "Gerar 2, o usuário escolhe" (#423, ADR-0029 dec.6): opt-in SÓ no modo structured (free_text fica
  // fora desta fatia) E com a config ligada. Governa o eixo de divergência (abaixo) e o CAMINHO NOVO de
  // geração-lista (mais adiante). O `body.variar2` é o pedido do cliente; o servidor é a verdade.
  const variar2 = mode === 'structured' && body.variar2 === true && recipeVariantCfg.enabled

  // Eixos de composição do prompt (#420/#421/#422/#423, ADR-0029) — RESOLVIDOS na borda por SPREAD
  // ADITIVO (Regra C do contrato de merge): cada helper resolveXAxis devolvendo {} colapsa para
  // NEUTRAL_AXES byte-a-byte, preservando o back-compat. Nível (#421) e Variação (#423) são resolvidos
  // AQUI (não dependem da cozinha); a voz da cozinha (#422) precisa de `briefing.cozinha`, só conhecida
  // APÓS o parseBriefing (SÓ structured) — lá o `axes` ganha o eixo de voz por spread aditivo. Por isso
  // `axes` é `let` e o `promptStamp` é montado UMA vez adiante (após as bordas), já com o axes completo.
  //
  // Nível de habilidade (#421, dec.2): override do body (SÓ structured — free_text não tem seletor)
  // ?? default do Perfil (users.nivelPadrao). Um único SELECT em `users` pelo ownerId (nivelPadrao é
  // NULL em contas que nunca escolheram ⇒ eixo neutro). A precedência FINA (texto explícito do
  // usuário > este eixo) vive IN-BAND no fragmento, não aqui.
  const nivelOverride: NivelChef | null =
    mode === 'structured' && typeof body.nivel === 'string' && isNivelChef(body.nivel)
      ? body.nivel
      : null
  const [meRow] = await getDb()
    .select({ nivelPadrao: users.nivelPadrao })
    .from(users)
    .where(eq(users.id, ownerId))
  const nivelPadrao: NivelChef | null =
    meRow?.nivelPadrao != null && isNivelChef(meRow.nivelPadrao) ? meRow.nivelPadrao : null
  let axes: PromptAxes = {
    ...resolveNivelChefAxis(nivelOverride, nivelPadrao),
    ...resolveVariacaoAxis(variar2 ? recipeVariantCfg : null),
  }

  if (mode === 'structured') {
    // "Outra" (#319, ADR-0025 Decisão 5): cozinha livre escolhida na autoria. Aqui o slug é só
    // COMPUTADO (puro, sem tocar o DB) e INJETADO no briefing ANTES da validação — a MATERIALIZAÇÃO
    // do termo `suggested` fica DEFERIDA pra depois de TODOS os portões (ingrediente/quota/invalid).
    // Por quê deferir: gravar o termo aqui deixava (i) órfãos num 400/429/502 e (ii) um caminho de
    // ABUSO — um usuário no teto (429) repostava com `cozinhaOutra` distintos e cada slug novo
    // inundava a fila do Curador (#320) BURLANDO o único limite da rota. Injetar o slug agora faz o
    // parseBriefing (i) ACEITÁ-LO (conjunto ativo aumentado com ele) e (ii) contar um briefing "só
    // Outra" (sem itens) como NÃO-vazio (senão isBriefingVazio devolveria 400 com a cozinha ainda
    // null). Texto que dobra p/ slug vazio (só símbolo/espaço) OU longo demais ⇒ 400 cozinha_invalida
    // (espelha a borda de edição PATCH; não produz silenciosamente uma receita sem cozinha).
    let briefingInput: unknown = body.briefing
    let cozinhasParaValidar = activeCozinhas
    if (typeof body.cozinhaOutra === 'string' && body.cozinhaOutra.trim() !== '') {
      if (body.cozinhaOutra.trim().length > COZINHA_OUTRA_MAX) {
        return Response.json({ error: 'cozinha_invalida' }, { status: 400 })
      }
      suggested = cozinhaSlugFromText(body.cozinhaOutra)
      if (suggested == null) {
        return Response.json({ error: 'cozinha_invalida' }, { status: 400 })
      }
      cozinhasParaValidar = new Set([...activeCozinhas, suggested])
      if (
        typeof briefingInput === 'object' &&
        briefingInput !== null &&
        !Array.isArray(briefingInput)
      ) {
        briefingInput = { ...(briefingInput as Record<string, unknown>), cozinha: suggested }
      }
    }

    // a. Valida shape + faixas + campo-mínimo do Briefing — TUDO antes do seam. O dedup
    //    silencioso já está aplicado dentro de parseBriefing. Cozinha é DATA-DRIVEN (#318): o
    //    conjunto ATIVO (já carregado acima, + o slug "Outra" injetado) vem do DB DIRETO — uma
    //    cozinha ativa qualquer (inclusive 'americana') é aceita; só slug NÃO-ativo vira 400.
    const parsed = parseBriefing(briefingInput, cozinhasParaValidar)
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

    // c'. Cozinha-como-voz (#422, ADR-0029 dec.3): quando o briefing tem cozinha, carrega a voz do
    //     vocabulário (QUALQUER status — pode ser o slug 'Outra' `suggested`, ainda não materializado,
    //     então `loadCozinhaVoice` devolve null e o genérico dispara com nome=slug) e RESOLVE o eixo
    //     por SPREAD ADITIVO (Regra C). Sem cozinha ⇒ `resolveVozCozinhaAxis` devolve {} ⇒ axes segue
    //     NEUTRO byte-a-byte. Isto molda o systemPrompt (passo d) e é carimbado no promptStamp adiante.
    const voz = briefing.cozinha != null ? await loadCozinhaVoice(getDb(), briefing.cozinha) : null
    axes = { ...axes, ...resolveVozCozinhaAxis(voz, briefing.cozinha) }

    // d. Monta {systemPrompt, userPrompt} a partir do Briefing (substitui placeholders). Eixos (#420/
    //    #422) resolvidos na borda moldam o systemPrompt via buildSystemPrompt.
    const prompt = buildBriefingPrompt(briefing, axes)
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
    const prompt = buildFreeTextPrompt(freeText, axes)
    systemPrompt = prompt.systemPrompt
    userPrompt = prompt.userPrompt
  }

  // Carimbo de versão do prompt (#420/#421/#422/#423, ADR-0029): a versão corrente + os eixos JÁ
  // resolvidos na borda (Nível, voz da cozinha, variação quando presentes). Persistido como proveniência
  // da geração p/ correlação futura com save/estrela. Montado AQUI (após as bordas) porque `axes` só está
  // completo agora (a voz da cozinha entra no ramo structured). `cfg`/`model` já foram resolvidos no topo
  // (o eixo de variação #423 precisa deles ANTES dos prompts).
  const promptStamp = promptStampFor(axes)

  // Teto de geração de RECEITA por papel (#167), janela 24h deslizante — ANTES de tocar o Claude
  // (custo). `cfg`/`model` já resolvidos acima (a linha singleton carrega ambos). cap ∞ (admin/papel
  // ilimitado) pula a contagem. Estourou ⇒ 429 com countdown, mensagem AMIGÁVEL na UI. Espelha o teto
  // de imagem (#132/#134). #423: "gerar 2" custa 2× ⇒ exige 2 SLOTS livres — reusa a MESMA máquina de
  // 1-slot com um cap REDUZIDO (`cap - 1`): permitido sob cap-1 ⟺ cabem 2 (inWindow < cap-1 ⟺
  // inWindow+2 <= cap). Estourou no variar2 ⇒ chave DISTINTA (a UI explica que foram pedidas 2).
  const capByRole = cfg?.recipeGenCapByRole ?? DEFAULT_RECIPE_GEN_CAP_BY_ROLE
  const cap = capFromRecipeGenConfig(capByRole, g.session.user.role)
  // #423: "gerar 2" custa 2 SLOTS ⇒ cap efetivo `cap-1` (permitido sob cap-1 ⟺ cabem 2).
  const effectiveCap = variar2 ? cap - 1 : cap
  // Pré-check BARATO (otimização, NÃO-atômico, #446): early-reject sem tocar o Claude no caso
  // claramente-acima-do-teto. A ENFORCEMENT real é o gate ATÔMICO (advisory lock + recontagem) DENTRO
  // da tx de persistGeneration (via `quotaGate` abaixo) — o pré-check sozinho tem corrida TOCTOU.
  if (Number.isFinite(cap)) {
    const now = new Date()
    const recentAt = await loadRecentRecipeGenAt(getDb(), ownerId, now)
    const quota = decideRecipeGenQuota({ cap: effectiveCap, recentAt, now })
    if (!quota.allowed) {
      return Response.json(
        {
          error: variar2 ? 'limite_geracao_variacao' : 'limite_geracao',
          retryAfterMs: quota.retryAfterMs,
        },
        { status: 429 },
      )
    }
  }
  // #446: gate ATÔMICO threado em persistGeneration — reconta+decide+insere SOB a advisory lock do
  // usuário, na MESMA tx do INSERT. Estourou (corrida) ⇒ persistGeneration LANÇA QuotaExceededError.
  const quotaGate = Number.isFinite(cap) ? { userId: ownerId, cap: effectiveCap } : undefined

  // origin por modo (#88): conversation já foi rejeitado acima (vive na rota de stream), então
  // só restam free_text → ai_free_text e structured → ai_structured.
  const origin: PersistOrigin = mode === 'free_text' ? 'ai_free_text' : 'ai_structured'

  // O Briefing (o PEDIDO) é persistido como proveniência mesmo quando a entrega é impossible (AC4):
  // tabelas separadas da Receita, a sessão aponta para AMBOS. Computado ANTES da chamada ao Claude
  // (puro; só depende do briefing já validado) — COMPARTILHADO pelo caminho single E pelo de variação.
  // `briefing.cozinha` já é o slug `suggested` (injetado na validação, #319) quando há "Outra".
  const persistBriefing: PersistBriefing | undefined = briefing
    ? {
        cozinha: briefing.cozinha,
        restricoes: briefing.restricoes,
        porcoes: briefing.porcoes,
        // #421: Dificuldade não é mais entrada do Briefing (virou saída estimada pela IA).
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

  // ── "Gerar 2, o usuário escolhe" (#423, ADR-0029 dec.6) — CAMINHO NOVO paralelo ao single ────────
  // Só structured, opt-in, config ligada (variar2). UMA chamada structured-LISTA → classifyVariants →
  // exige 2 variações VÁLIDAS (com Receita) → persiste AMBAS compartilhando um variantGroupId (cada uma
  // PRIVADA, com o seu pólo) → devolve os 2 recipeIds/slugs. `generateRecipe` (single) fica INTACTO.
  if (variar2) {
    const outs = await getClaudeClient().generateRecipeVariants({
      systemPrompt,
      userPrompt,
      model,
      cozinhaSlugs: [...activeCozinhas],
      axes,
    })
    const variantResults = classifyVariants(outs)
    // Exige DUAS variações válidas. Menos que isso (parse do lote falhou / refusal / max_tokens / uma
    // variação impossible ou fora-de-faixa) ⇒ 502 — NÃO degrada pra uma só (ADR-0029 dec.6).
    if (variantResults.length !== 2) {
      return Response.json({ outcome: 'invalid', error: 'geracao_invalida' }, { status: 502 })
    }

    // "Outra" (#319): materializa o termo `suggested` UMA vez — todos os portões passaram.
    if (suggested != null) await suggestCozinha(getDb(), body.cozinhaOutra as string, ownerId)

    // As 2 gerações compartilham o MESMO variantGroupId (agrupa o lote). Cada uma nasce PRIVADA, com o
    // seu pólo (variantLabel) e o mesmo promptStamp; variant_chosen nasce NULL (a escolha o marca).
    const variantGroupId = crypto.randomUUID()
    const variants: {
      recipeId: string
      slug?: string
      locale?: string
      label: string
      generationId: string
      outcome: 'success' | 'degraded' | 'playful'
      advisory: string | null
    }[] = []
    // #446: gate ATÔMICO das DUAS variações. O par persiste em 2 tx sucessivas; só a PRIMEIRA carrega
    // o `quotaGate` (com effectiveCap=cap-1 ⇒ exige 2 slots livres SOB a lock). Estourou na corrida ⇒
    // QuotaExceededError → 429 limite_geracao_variacao, e NENHUMA das duas nasce (a 1ª reverte antes de
    // inserir; a 2ª nem roda). A 2ª persist vai sem gate (é o par já reservado pela 1ª).
    let firstVariant = true
    try {
      for (const vr of variantResults) {
        // "Outra" (#319): a IA emitiu cozinha=null (slug suggested fora do z.enum ativo); o servidor estampa.
        if (suggested != null) vr.recipe.cozinha = suggested
        const p = await persistGeneration({
          result: { outcome: vr.outcome, recipe: vr.recipe, advisory: vr.advisory },
          mode,
          origin,
          ownerId,
          model,
          briefing: persistBriefing,
          promptStamp,
          variantGroupId,
          variantLabel: vr.variacao,
          quota: firstVariant ? quotaGate : undefined,
        })
        firstVariant = false
        if (p?.recipeId) {
          // #119: embeda cada Receita (best-effort, assistivo). Falha NÃO derruba a criação.
          await embedTranslation(getDb(), p.recipeId, vr.recipe.originalLocale).catch(() => {})
          variants.push({
            recipeId: p.recipeId,
            ...(p.slug != null ? { slug: p.slug } : {}),
            ...(p.locale != null ? { locale: p.locale } : {}),
            label: vr.variacao,
            generationId: p.generationId,
            outcome: vr.outcome,
            advisory: vr.advisory,
          })
        }
      }
    } catch (err) {
      // #446: corrida perdida na recontagem ATÔMICA (advisory lock) ⇒ a 1ª variação reverteu e a 2ª nem
      // rodou — nenhuma nasceu. 429 limite_geracao_variacao (a UI explica que foram pedidas 2).
      if (err instanceof QuotaExceededError) {
        return Response.json(
          { error: 'limite_geracao_variacao', retryAfterMs: err.retryAfterMs },
          { status: 429 },
        )
      }
      throw err
    }
    // Defesa: se alguma persistência não devolveu recipeId (não ocorre em success/degraded/playful), 502.
    if (variants.length !== 2) {
      return Response.json({ outcome: 'invalid', error: 'geracao_invalida' }, { status: 502 })
    }
    return Response.json({ outcome: 'variants', variants }, { status: 201 })
  }

  const out = await getClaudeClient().generateRecipe({
    systemPrompt,
    userPrompt,
    model,
    // #318: constrange a cozinha da SAÍDA structured ao vocabulário VIVO (data-driven). Mesmo
    // conjunto ATIVO hoisted acima — vale p/ structured E free_text (a IA só emite cozinhas vivas).
    cozinhaSlugs: [...activeCozinhas],
    // #420 (ADR-0029): eixos que produziram esta geração (já embutidos no systemPrompt). Neutro na Wave 1.
    axes,
  })
  const result = classify(out)

  // Erro de sistema puro: NÃO persiste nada (sem creation_session/generation/recipe/briefing).
  if (result.outcome === 'invalid') {
    return Response.json({ outcome: 'invalid', error: 'geracao_invalida' }, { status: 502 })
  }

  // "Outra" (#319, ADR-0025 Decisão 5): MATERIALIZA o termo `suggested` SÓ AQUI — todos os portões
  // passaram (ingrediente 400, quota 429, invalid 502). A FK `briefing.cozinha` (persistida no
  // caminho impossible E no de sucesso, logo abaixo) exige a linha existir. Dedup-na-entrada
  // idempotente e segura sob corrida (recomputa o MESMO slug de `suggested`). Deferir até aqui é o
  // que impede termo órfão num 400/429/502 e fecha o abuso de inundar a fila do Curador no 429.
  if (suggested != null) await suggestCozinha(getDb(), body.cozinhaOutra as string, ownerId)

  // `persistBriefing` já foi computado acima (compartilhado pelo caminho single E pelo de variação #423).
  if (result.outcome === 'impossible') {
    // Impossible NÃO carrega Aviso (§4.4/E7): sem Receita entregue, não há Aviso.
    try {
      await persistGeneration({ result, mode, origin, ownerId, model, briefing: persistBriefing, freeText, promptStamp, quota: quotaGate })
    } catch (err) {
      // #446: corrida perdida na recontagem atômica ⇒ nada persistiu. 429 limite_geracao (mesmo contrato).
      if (err instanceof QuotaExceededError) {
        return Response.json({ error: 'limite_geracao', retryAfterMs: err.retryAfterMs }, { status: 429 })
      }
      throw err
    }
    return Response.json({ outcome: 'impossible', advisory: result.advisory }, { status: 200 })
  }

  // "Outra" (#319, ADR-0025 Decisão 5): a IA emitiu `cozinha=null` (o slug `suggested` não está no
  // `z.enum` dos ativos); o SERVIDOR estampa o slug pós-geração na Receita ENTREGUE. Só aqui (com
  // Receita) — o ramo `impossible` retorna acima sem `result.recipe`. `briefing.cozinha=suggested`
  // já flui via persistBriefing. A FK valida (a linha `suggested` existe); a contenção mantém o
  // termo invisível em superfície pública até o Curador aprovar (#320). Publicar NÃO é bloqueado.
  if (suggested != null) result.recipe.cozinha = suggested

  // success | degraded | playful → Receita privada + generation.
  let p: Awaited<ReturnType<typeof persistGeneration>>
  try {
    p = await persistGeneration({
      result,
      mode,
      origin,
      ownerId,
      model,
      briefing: persistBriefing,
      freeText,
      promptStamp,
      quota: quotaGate,
    })
  } catch (err) {
    // #446: corrida perdida na recontagem ATÔMICA (advisory lock) ⇒ a tx reverteu, NADA persistiu. 429.
    if (err instanceof QuotaExceededError) {
      return Response.json({ error: 'limite_geracao', retryAfterMs: err.retryAfterMs }, { status: 429 })
    }
    throw err
  }

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
    // gen schema emite `nome` (sem medida); o motor de aviso escaneia o TEXTO do item por alérgeno.
    ingredientes: result.recipe.ingredientes.map((i) => ({ rawText: i.nome })),
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
