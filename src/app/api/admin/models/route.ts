import { requireRole } from '@/server/auth/guard'
import { getModelCatalog } from '@/server/deps'
import { loadSelectableModels } from '@/server/claude/model-catalog'

/**
 * Modelos de texto que o admin pode escolher como `defaultModel` — ADMIN-ONLY. Vem da Models API da
 * Anthropic (o mais novo de cada família: Opus, Sonnet, Fable; cache de 1h), com lista pinada de
 * fallback. O PUT de `/api/admin/config` valida contra ESTA mesma lista.
 */
export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response
  return Response.json({ models: await loadSelectableModels(getModelCatalog()) })
}
