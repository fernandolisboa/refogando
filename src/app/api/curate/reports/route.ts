import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { listReportQueue } from '@/server/curate/reports'

/**
 * Fila de Reports do Curador (issue #18, AC1). GET curador-only: `requireRole(req,'curador')`
 * (VERBATIM — fail-closed; Visitante → 401, `usuario` → 403, `curador`/`admin` → 200);
 * `listReportQueue(db)` devolve os pending com `origin` + `result_kind` visíveis. Espelha
 * `curate/translations/stale` (forma de rota e role-gating).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const reports = await listReportQueue(getDb())
  return Response.json({ reports }, { status: 200 })
}
