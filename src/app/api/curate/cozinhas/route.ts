import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { listSuggestedCozinhas } from '@/server/vocabulary/curate'

/**
 * Fila de cozinhas SUGERIDAS do Curador (#320, ADR-0025 Decisão 5). GET curador-only:
 * `requireRole(req,'curador')` (VERBATIM — fail-closed; Visitante → 401, `usuario` → 403,
 * `curador`/`admin` → 200). Lista os termos `suggested` com `recipeCount` (DB-direto, não o cache
 * de `loadVocabulary`). DB embrulhado em try/catch → `erro_interno` 500 sem stack (igual ao
 * /api/admin/vocabulary). Espelha a forma de `/api/curate/reports`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response
  try {
    return Response.json({ cozinhas: await listSuggestedCozinhas(getDb()) }, { status: 200 })
  } catch {
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
}
