import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { appConfig } from '@/db/schema'
import { loadAppConfig } from '@/server/app-config'
import { parseImageGenConfig, type ImageGenConfig } from '@/domain/image-gen-config'
import { parseRecipeGenCapByRole, type RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { parseWebSearchConfig } from '@/domain/web-search-config'

/**
 * Config de app — ADMIN-ONLY (Curador/Usuário → 403). GET lê; PUT grava. Persiste no singleton
 * `app_config` (linha id=true, garantida por CHECK no schema).
 *
 * EIXOS INDEPENDENTES de config, atualizáveis em separado (cada UI envia só o seu):
 *  - `defaultModel` (#5) — modelo de chat. allowlist EM CÓDIGO (muda mais rápido que migração).
 *  - `imageGen { enabled, model, dailyCapByRole }` (#134) — geração de imagem por IA (a `/admin/ai`).
 *    A geração lê estes valores no lugar dos defaults fixos (`image-quota.ts` → `image-gen-config.ts`).
 *  - `recipeGenCapByRole` (#167) — teto diário de geração de RECEITA por papel (também a `/admin/ai`).
 *    Record<Role, number|null> (`null` = ∞); a rota /api/generations lê este valor pelo teto.
 *  - `webSearch { enabled, allowlist }` (#164, ADR-0019) — descoberta na web (também a `/admin/ai`).
 *    A allowlist é fonte ÚNICA do endpoint `/api/discovery/web` E do guard de SSRF do import (#165).
 *
 * PUT aceita `defaultModel` E/OU `imageGen` E/OU `recipeGenCapByRole` E/OU `webSearch` (ao menos um);
 * valida cada campo PRESENTE; faz upsert só dos campos enviados (preserva os outros eixos). Corpo
 * vazio/sem campo conhecido ⇒ 400. Erro de DB → `erro_interno` 500 sem stack (consistente com /api/admin/roles).
 */
const ALLOWED_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6'] as const

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
    webSearch?: unknown
  }

  // Acumula só os campos a gravar (upsert parcial). `set` para o onConflict; `insertExtra` p/ o
  // primeiro insert do singleton (os demais campos caem nos DEFAULTs do schema).
  const set: Partial<{
    defaultModel: string
    imageGenEnabled: boolean
    imageGenModel: string
    imageGenCapByRole: ImageGenConfig['dailyCapByRole']
    recipeGenCapByRole: RecipeGenCapByRole
    webSearchEnabled: boolean
    webSearchAllowlist: string[]
  }> = {}

  if (body.defaultModel !== undefined) {
    const m = body.defaultModel
    if (typeof m !== 'string' || !ALLOWED_MODELS.includes(m as (typeof ALLOWED_MODELS)[number])) {
      return Response.json({ error: 'modelo_invalido' }, { status: 400 })
    }
    set.defaultModel = m
  }

  if (body.imageGen !== undefined) {
    const parsed = parseImageGenConfig(body.imageGen)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.imageGenEnabled = parsed.value.enabled
    set.imageGenModel = parsed.value.model
    set.imageGenCapByRole = parsed.value.dailyCapByRole
  }

  // #167: teto de geração de RECEITA por papel (mesma validação do teto de imagem — null=∞ ou inteiro
  // ≥0, exatamente os papéis conhecidos). Inválido ⇒ 400 config_invalida (mesma chave da UI /admin/ai).
  if (body.recipeGenCapByRole !== undefined) {
    const caps = parseRecipeGenCapByRole(body.recipeGenCapByRole)
    if (caps === null) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.recipeGenCapByRole = caps
  }

  // #164: descoberta na web (enabled + allowlist de domínios). A allowlist é CANONICALIZADA na
  // validação (minúsculo, sem www., dedup); domínio mal formado ⇒ 400 config_invalida (não engole
  // lixo). Substituição COMPLETA do eixo (a UI sempre envia os 2 campos).
  if (body.webSearch !== undefined) {
    const parsed = parseWebSearchConfig(body.webSearch)
    if (!parsed.ok) return Response.json({ error: 'config_invalida' }, { status: 400 })
    set.webSearchEnabled = parsed.value.enabled
    set.webSearchAllowlist = parsed.value.allowlist
  }

  // Nada conhecido a atualizar ⇒ 400 (não vira no-op 200 silencioso).
  if (Object.keys(set).length === 0) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  try {
    await getDb()
      .insert(appConfig)
      .values({ id: true, ...set })
      .onConflictDoUpdate({
        target: appConfig.id,
        set: { ...set, updatedAt: new Date() },
      })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }

  // Relê o estado completo persistido (espelha o GET) — a UI reflete o singleton inteiro.
  return Response.json(await loadAppConfig(getDb()))
}
