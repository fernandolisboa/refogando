import { requireRole } from '@/server/auth/guard'
import { getDb, getModelCatalog, getModelProbe } from '@/server/deps'
import { validateAiTaskUpdate } from '@/server/claude/ai-task-update'
import {
  AI_TASKS,
  activeSettings,
  parseStoredAiTasks,
  withTaskSettings,
  type AiTask,
  type ModelSettings,
  type StoredAiTasks,
} from '@/domain/ai-task-config'
import { appConfig } from '@/db/schema'
import { loadAppConfig } from '@/server/app-config'
import { selectableFamilyOf } from '@/domain/claude-models'
import { parseImageGenConfig, type ImageGenConfig } from '@/domain/image-gen-config'
import { parseRecipeGenCapByRole, type RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { parseExtractionCapByRole, type ExtractionCapByRole } from '@/domain/extraction-cap-config'
import { parseProCaps, type ProCaps } from '@/domain/pro-caps'
import { parseRecipeVariantConfig, type RecipeVariantConfig } from '@/domain/recipe-variant-config'
import { parseWebSearchConfig, deniedDomainsIn } from '@/domain/web-search-config'
import { parseCatalogDisclosureConfig } from '@/domain/catalog-disclosure-config'
import { parsePopularityConfig, type PopularityConfig } from '@/domain/popularity'
import { parseSocialLinksConfig, type SocialLinksConfig } from '@/domain/social-links-config'
import {
  parseRecipeOfWeekConfig,
  type RecipeOfWeekConfig,
} from '@/domain/recipe-of-week-config'
import { isCatalogRecipeApproved } from '@/server/recipe/recipe-of-week'

/**
 * Config de app — ADMIN-ONLY (Curador/Usuário → 403). GET lê; PUT grava. Persiste no singleton
 * `app_config` (linha id=true, garantida por CHECK no schema).
 *
 * EIXOS INDEPENDENTES de config, atualizáveis em separado (cada UI envia só o seu):
 *  - `defaultModel` (#5) — modelo da Geração (legado; a UI manda `aiTasks.generation`). Tratado como a
 *    tarefa Geração com o ajuste já salvo para o modelo: mesmos portões do `aiTasks` abaixo (modelos
 *    SELECIONÁVEIS segundo a Models API, com lista pinada de fallback; Haiku não é selecionável).
 *  - `imageGen { enabled, model, dailyCapByRole }` (#134) — geração de imagem por IA (aba IA, `/admin/ia`).
 *    A geração lê estes valores no lugar dos defaults fixos (`image-quota.ts` → `image-gen-config.ts`).
 *  - `recipeGenCapByRole` (#167) — teto diário de geração de RECEITA por papel (também a aba IA, `/admin/ia`).
 *    Record<Role, number|null> (`null` = ∞); a rota /api/generations lê este valor pelo teto.
 *  - `extractionCapByRole` (#447) — teto diário de EXTRAÇÃO de ingredientes por papel (mesma forma;
 *    defaults mais folgados). A rota /api/parse-ingredients lê este valor pelo teto (reserva atômica).
 *  - `webSearch { enabled, allowlist }` (#164, ADR-0019) — descoberta na web (aba Descoberta, `/admin/descoberta`).
 *    A allowlist é fonte ÚNICA do endpoint `/api/discovery/web` E do guard de SSRF do import (#165).
 *  - `catalogDisclosure { enabled, text }` (#237, SEO #187) — aviso OPCIONAL "em colaboração entre
 *    curadoria e IA" exibido SÓ em receitas `origin=catalog` quando ligado. CORTESIA editorial — NUNCA
 *    suprime os selos obrigatórios de proveniência (`ai_*` / imagem `ai_generated`). Texto editável.
 *  - `recipeOfWeek { recipeId }` (#457) — a Receita escolhida pelo Curador pro slot editorial
 *    "Receita da semana" da home (aba Curadoria, `/admin/catalog`). `recipeId: null` ⇒ ninguém
 *    escolheu, a home cai no fallback automático por Popularidade. `recipeId` não-null é VALIDADO
 *    contra o catálogo aprovado ATUAL (`isCatalogRecipeApproved`) — escolher uma receita que não é
 *    catálogo/aprovado ⇒ 400 `receita_invalida` (não persiste um id que a leitura descartaria depois).
 *
 *  - `proCaps { recipeGen, imageGen, extraction }` (Fase 2 de billing, #466) — a tabela `pro` dos tetos
 *    de cota. `null` LIMPA a tabela pro (volta ao byte-idêntico free); objeto ⇒ validado (tudo-ou-nada).
 *    NÃO ativa cobrança: só habilita um usuário `plan='pro'` (concedido à parte) a pegar tetos maiores.
 *
 *  - `aiTasks { [tarefa]: { model, settings } }` (ADR-0034) — modelo + esforço/thinking por tarefa de
 *    IA de texto (Geração, Tradução, Extração), validados por capacidades + chamada de teste. O jsonb é
 *    regravado sob lock da linha (salvamentos concorrentes não se sobrescrevem).
 *
 * PUT aceita `defaultModel` E/OU `aiTasks` E/OU `imageGen` E/OU `recipeGenCapByRole` E/OU `webSearch` E/OU
 * `catalogDisclosure` E/OU `recipeOfWeek` E/OU `proCaps` (ao menos um); valida cada campo PRESENTE;
 * faz upsert só dos campos enviados (preserva os outros eixos). Corpo vazio/sem campo conhecido ⇒ 400.
 * Erro de DB → `erro_interno` 500 sem stack (consistente com /api/admin/roles).
 */
// ADR-0034: salvar `aiTasks` faz uma chamada de teste à Anthropic por tarefa (até 20s cada, em paralelo)
// + a lista de modelos (até 5s). Folga além dos 10s default do Vercel Hobby.
export const maxDuration = 60

export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response
  const cfg = await loadAppConfig(getDb())
  return Response.json(cfg)
}

export async function PUT(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as {
    defaultModel?: unknown
    imageGen?: unknown
    recipeGenCapByRole?: unknown
    extractionCapByRole?: unknown
    recipeVariant?: unknown
    webSearch?: unknown
    catalogDisclosure?: unknown
    popularity?: unknown
    socialLinks?: unknown
    recipeOfWeek?: unknown
    proCaps?: unknown
    aiTasks?: unknown
  }

  // Acumula só os campos a gravar (upsert parcial). `set` para o onConflict; `insertExtra` p/ o
  // primeiro insert do singleton (os demais campos caem nos DEFAULTs do schema).
  const set: Partial<{
    defaultModel: string
    imageGenEnabled: boolean
    imageGenModel: string
    imageGenCapByRole: ImageGenConfig['dailyCapByRole']
    recipeGenCapByRole: RecipeGenCapByRole
    extractionCapByRole: ExtractionCapByRole
    recipeVariantConfig: RecipeVariantConfig
    webSearchEnabled: boolean
    webSearchAllowlist: string[]
    catalogDisclosureEnabled: boolean
    catalogDisclosureText: string
    popularityConfig: PopularityConfig
    socialLinks: SocialLinksConfig
    recipeOfWeekConfig: RecipeOfWeekConfig
    proCaps: ProCaps | null
    aiTasks: StoredAiTasks
  }> = {}

  // ADR-0034: troca de modelo/ajuste por tarefa de IA. `defaultModel` (legado #5) é a tarefa Geração com o
  // ajuste já salvo para aquele modelo (ou o default): passa pelos MESMOS portões (modelo oferecível,
  // capacidades, chamada de teste). `aiTasks.generation` no mesmo corpo vence.
  const aiUpdates = new Map<AiTask, unknown>()
  let legacyGenerationModel: string | null = null
  if (body.defaultModel !== undefined) {
    const m = body.defaultModel
    if (typeof m !== 'string') return Response.json({ error: 'modelo_invalido' }, { status: 400 })
    legacyGenerationModel = m
  }
  if (body.aiTasks !== undefined) {
    const entries = typeof body.aiTasks === 'object' && body.aiTasks !== null ? Object.entries(body.aiTasks) : []
    if (entries.length === 0 || entries.some(([task]) => !(AI_TASKS as readonly string[]).includes(task))) {
      return Response.json({ error: 'config_invalida' }, { status: 400 })
    }
    for (const [task, raw] of entries) aiUpdates.set(task as AiTask, raw)
  }
  if (body.imageGen !== undefined) {
    const parsed = parseImageGenConfig(body.imageGen)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.imageGenEnabled = parsed.value.enabled
    set.imageGenModel = parsed.value.model
    set.imageGenCapByRole = parsed.value.dailyCapByRole
  }

  // #167: teto de geração de RECEITA por papel (mesma validação do teto de imagem — null=∞ ou inteiro
  // ≥0, exatamente os papéis conhecidos). Inválido ⇒ 400 config_invalida (mesma chave da UI /admin/ia).
  if (body.recipeGenCapByRole !== undefined) {
    const caps = parseRecipeGenCapByRole(body.recipeGenCapByRole)
    if (caps === null) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.recipeGenCapByRole = caps
  }

  // #447: teto de EXTRAÇÃO de ingredientes por papel (mesma validação — null=∞ ou inteiro ≥0, exatamente
  // os papéis conhecidos). Inválido ⇒ 400 config_invalida. A rota /api/parse-ingredients lê este valor.
  if (body.extractionCapByRole !== undefined) {
    const caps = parseExtractionCapByRole(body.extractionCapByRole)
    if (caps === null) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.extractionCapByRole = caps
  }

  // #423: variação de geração ("gerar 2, o usuário escolhe"). enabled boolean + poloA/poloB/instrucao
  // não-vazios (trimados). Substituição COMPLETA do eixo (a UI sempre envia os 4 campos). Inválido ⇒ 400
  // config_invalida (mesma chave da UI /admin/ia).
  if (body.recipeVariant !== undefined) {
    const parsed = parseRecipeVariantConfig(body.recipeVariant)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.recipeVariantConfig = parsed.value
  }

  // #164: descoberta na web (enabled + allowlist de domínios). A allowlist é CANONICALIZADA na
  // validação (minúsculo, sem www., dedup); domínio mal formado ⇒ 400 config_invalida (não engole
  // lixo). Substituição COMPLETA do eixo (a UI sempre envia os 2 campos).
  if (body.webSearch !== undefined) {
    const parsed = parseWebSearchConfig(body.webSearch)
    if (!parsed.ok) {
      // #394: distingue "domínio vetado por ToS" (denylist em código) de "config malformada", pra a
      // rejeição vir com MOTIVO claro (não engolir em silêncio). A denylist é reversível/jurídica.
      const denied = deniedDomainsIn(body.webSearch)
      if (denied.length > 0) {
        return Response.json({ error: 'dominio_vetado', domains: denied }, { status: 400 })
      }
      return Response.json({ error: 'config_invalida' }, { status: 400 })
    }
    set.webSearchEnabled = parsed.value.enabled
    set.webSearchAllowlist = parsed.value.allowlist
  }

  // #237: aviso de catálogo AI-assistido (enabled + texto editável). O texto é TRIMADO na validação;
  // vazio/só-espaço ⇒ 400 config_invalida (não persiste frase vazia). Substituição COMPLETA do eixo
  // (a UI sempre envia os 2 campos). CORTESIA editorial — não toca os selos obrigatórios de proveniência.
  if (body.catalogDisclosure !== undefined) {
    const parsed = parseCatalogDisclosureConfig(body.catalogDisclosure)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.catalogDisclosureEnabled = parsed.value.enabled
    set.catalogDisclosureText = parsed.value.text
  }

  // #368: constantes da mistura de popularidade (pesos + m + tauDays). O parse REJEITA Infinity/NaN/
  // negativo/m<=0/tau<=0 (fechado, `Number.isFinite`); inválido ⇒ 400 config_invalida. Substituição
  // COMPLETA do eixo (a UI sempre envia os 5 campos). Sem deploy: o ranking relê a config por request.
  if (body.popularity !== undefined) {
    const parsed = parsePopularityConfig(body.popularity)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.popularityConfig = parsed.value
  }

  // #451: links de redes sociais do site (footer). Lista de {platform, url, label?, enabled} —
  // allowlist de plataforma em código, URL http(s) segura (safeHttpUrl), sem duplicata. Substituição
  // COMPLETA do eixo (a UI sempre envia a lista inteira). Inválido ⇒ 400 config_invalida.
  if (body.socialLinks !== undefined) {
    const parsed = parseSocialLinksConfig(body.socialLinks)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.socialLinks = parsed.value
  }

  // #457: "Receita da semana" — `{ recipeId }`. Forma inválida (nem uuid nem null) ⇒ 400
  // config_invalida. `recipeId` presente E bem-formado é AINDA validado contra o catálogo aprovado
  // ATUAL (`isCatalogRecipeApproved`) — escolher algo que não é catálogo/aprovado ⇒ 400
  // receita_invalida (o Curador recebe um motivo claro, em vez de um id persistido em vão que a
  // leitura do slot descartaria depois). `recipeId: null` (limpar a escolha) nunca precisa dessa
  // checagem — sempre válido (volta pro fallback de Popularidade).
  if (body.recipeOfWeek !== undefined) {
    const parsed = parseRecipeOfWeekConfig(body.recipeOfWeek)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    if (parsed.value.recipeId !== null) {
      const approved = await isCatalogRecipeApproved(getDb(), parsed.value.recipeId)
      if (!approved) return Response.json({ error: 'receita_invalida' }, { status: 400 })
    }
    set.recipeOfWeekConfig = parsed.value
  }

  // Fase 2 de billing (#466): tabela `pro` dos tetos de cota (`{ recipeGen, imageGen, extraction }`).
  // `null` explícito LIMPA a tabela pro (volta ao byte-idêntico free). Objeto ⇒ validado por
  // `parseProCaps` (tudo-ou-nada: os 3 eixos válidos, senão 400 config_invalida — mesma chave da UI).
  // NÃO ativa cobrança: só habilita um usuário `plan='pro'` (concedido à parte) a pegar o teto pro.
  if (body.proCaps !== undefined) {
    if (body.proCaps === null) {
      set.proCaps = null
    } else {
      const parsed = parseProCaps(body.proCaps)
      if (parsed === null) return Response.json({ error: 'config_invalida' }, { status: 400 })
      set.proCaps = parsed
    }
  }

  // Validado DEPOIS das checagens baratas dos outros eixos (a chamada de teste custa e leva segundos) e
  // ANTES da transação de escrita (não segura lock durante ela).
  const aiValidated: Array<{ task: AiTask; model: string; settings: ModelSettings }> = []
  if (aiUpdates.size > 0 || legacyGenerationModel !== null) {
    const cfg = await loadAppConfig(getDb())
    const tasks: Array<readonly [AiTask, unknown]> = [...aiUpdates.entries()]
    if (legacyGenerationModel !== null && !aiUpdates.has('generation')) {
      // `defaultModel` legado: o ajuste salvo para o modelo (ou o default da tarefa), sem `effort` fora
      // de Opus/Sonnet/Fable — o mesmo que a Geração manda em runtime (ex.: re-salvar um Haiku legado).
      const s = activeSettings('generation', { ...cfg.aiTasks.generation, model: legacyGenerationModel })
      const settings = selectableFamilyOf(legacyGenerationModel) ? s : { ...s, effort: null }
      tasks.push(['generation', { model: legacyGenerationModel, settings }])
    }
    // Tarefas validadas em paralelo: cada chamada de teste pode levar segundos.
    const results = await Promise.all(
      tasks.map(([task, raw]) =>
        validateAiTaskUpdate(raw, cfg.aiTasks[task].model, {
          catalog: getModelCatalog(),
          probe: getModelProbe(),
        }),
      ),
    )
    for (const [i, [task]] of tasks.entries()) {
      const res = results[i]
      if (!res.ok) {
        // Caminho legado: ID mal formado segue sendo `modelo_invalido`, como antes.
        const legacy = task === 'generation' && !aiUpdates.has('generation')
        const error = legacy && res.error === 'config_invalida' ? 'modelo_invalido' : res.error
        return Response.json(
          { error, task, ...('message' in res ? { message: res.message } : {}) },
          { status: 400 },
        )
      }
      aiValidated.push({ task, model: res.model, settings: res.settings })
      if (task === 'generation') set.defaultModel = res.model
    }
  }

  // Nada conhecido a atualizar ⇒ 400 (não vira no-op 200 silencioso).
  if (Object.keys(set).length === 0 && aiValidated.length === 0) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  try {
    await getDb().transaction(async (tx) => {
      if (aiValidated.length > 0) {
        // Ler-modificar-gravar do jsonb SOB LOCK da linha: dois salvamentos concorrentes (ex.: dois blocos
        // da aba IA) não se sobrescrevem. Garante a linha antes, p/ o FOR UPDATE ter o que travar.
        await tx.insert(appConfig).values({ id: true }).onConflictDoNothing()
        const [row] = await tx.select({ aiTasks: appConfig.aiTasks }).from(appConfig).for('update')
        let stored = parseStoredAiTasks(row?.aiTasks)
        for (const u of aiValidated) stored = withTaskSettings(stored, u.task, u.model, u.settings)
        set.aiTasks = stored
      }
      await tx
        .insert(appConfig)
        .values({ id: true, ...set })
        .onConflictDoUpdate({
          target: appConfig.id,
          set: { ...set, updatedAt: new Date() },
        })
    })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }

  // Relê o estado completo persistido (espelha o GET) — a UI reflete o singleton inteiro.
  return Response.json(await loadAppConfig(getDb()))
}
