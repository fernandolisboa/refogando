import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { appConfig } from '@/db/schema'
import { loadAppConfig } from '@/server/app-config'
import { parseImageGenConfig, type ImageGenConfig } from '@/domain/image-gen-config'

/**
 * Config de app — ADMIN-ONLY (Curador/Usuário → 403). GET lê; PUT grava. Persiste no singleton
 * `app_config` (linha id=true, garantida por CHECK no schema).
 *
 * Dois eixos INDEPENDENTES de config, atualizáveis em separado (cada UI envia só o seu):
 *  - `defaultModel` (#5) — modelo de chat. allowlist EM CÓDIGO (muda mais rápido que migração).
 *  - `imageGen { enabled, model, dailyCapByRole }` (#134) — geração de imagem por IA (a `/admin/ai`).
 *    A geração lê estes valores no lugar dos defaults fixos (`image-quota.ts` → `image-gen-config.ts`).
 *
 * PUT aceita `defaultModel` E/OU `imageGen` (ao menos um); valida cada campo PRESENTE; faz upsert só
 * dos campos enviados (preserva o outro eixo). Corpo vazio/sem campo conhecido ⇒ 400. Erro de DB →
 * `erro_interno` 500 sem stack (consistente com /api/admin/roles).
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
  }

  // Acumula só os campos a gravar (upsert parcial). `set` para o onConflict; `insertExtra` p/ o
  // primeiro insert do singleton (os demais campos caem nos DEFAULTs do schema).
  const set: Partial<{
    defaultModel: string
    imageGenEnabled: boolean
    imageGenModel: string
    imageGenCapByRole: ImageGenConfig['dailyCapByRole']
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
