import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { promotionList } from '@/server/curate/promotion'

/**
 * GET /api/curate/promotion — lista de promoção de ingredientes livres recorrentes
 * (issue #19, AC5). READ-ONLY: agrega/conta candidatos, NÃO escreve nada (a promoção de
 * fato reusa POST /api/curate/ingredients separadamente). Gating por papel (Curador).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const promotion = await promotionList(getDb())
  return Response.json({ promotion }, { status: 200 })
}
