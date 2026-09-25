import { requireRole } from '@/server/auth/guard'
import { getModelCatalog } from '@/server/deps'
import { loadSelectableModels } from '@/server/claude/model-catalog'

/**
 * Modelos de texto que o admin pode escolher para cada tarefa de IA (Geração, Tradução, Extração —
 * ADR-0034) — ADMIN-ONLY. Vem da Models API da Anthropic (o mais novo de cada família: Opus, Sonnet,
 * Fable; cache de 1h), com as capacidades de cada um e lista pinada de fallback. O PUT de
 * `/api/admin/config` valida contra ESTA mesma lista.
 */
export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response
  const { models } = await loadSelectableModels(getModelCatalog())
  return Response.json({ models })
}
