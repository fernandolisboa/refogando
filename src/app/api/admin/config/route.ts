import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { appConfig } from '@/db/schema'

/**
 * Config de app — modelo default da geração (issue #5, #5.AC2). GET lê; PUT grava. Ambos
 * ADMIN-ONLY (Curador/Usuário → 403). Persiste no singleton `app_config` (linha id=true,
 * garantida por CHECK no schema). NÃO liga geração real (isso é #8) — só persiste/expõe.
 *
 * `default_model` é text livre no banco; a fronteira de valores válidos é uma allowlist
 * EM CÓDIGO (muda mais rápido que migração): qualidade (opus) vs custo (sonnet).
 */
const ALLOWED_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6'] as const
const DEFAULT_MODEL = 'claude-opus-4-8'

export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response
  const [row] = await getDb().select().from(appConfig)
  // Linha ausente (sem seed na migração) → default em código.
  return Response.json({ defaultModel: row?.defaultModel ?? DEFAULT_MODEL })
}

export async function PUT(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { defaultModel?: unknown }
  const m = body.defaultModel
  if (typeof m !== 'string' || !ALLOWED_MODELS.includes(m as (typeof ALLOWED_MODELS)[number])) {
    return Response.json({ error: 'modelo_invalido' }, { status: 400 })
  }

  // Try/catch defensivo (E8): erro de DB → {error:'erro_interno'} 500 sem stack, por
  // consistência com /api/admin/roles. Upsert no singleton (id=true).
  try {
    await getDb()
      .insert(appConfig)
      .values({ id: true, defaultModel: m })
      .onConflictDoUpdate({
        target: appConfig.id,
        set: { defaultModel: m, updatedAt: new Date() },
      })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
  return Response.json({ defaultModel: m })
}
