import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { listReviewQueue } from '@/server/curate/review'

/**
 * Fila PROATIVA do Curador (#227, ADR-0022 dec.3) — `GET /api/curate/review-images`. Curador-only:
 * `requireRole(req,'curador')` (VERBATIM — fail-closed; Visitante → 401, `usuario` → 403,
 * `curador`/`admin` → 200); `listReviewQueue(db)` devolve as imagens `review_required AND
 * moderated_at IS NULL` com contexto da receita (título/owner via a linhagem). Espelha
 * `curate/reports` (forma de rota e role-gating). NÃO-bloqueante: as imagens seguem públicas.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const images = await listReviewQueue(getDb())
  return Response.json({ images }, { status: 200 })
}
