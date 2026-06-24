import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { dismissReviewImage } from '@/server/curate/review'

/**
 * Curador DISPENSA uma imagem da fila proativa (#227, ADR-0022 dec.3) — julgou a geração refinada
 * OK: zera `review_required` ⇒ a imagem cai da fila SEM moderar (segue pública, default-open
 * ADR-0020). POST curador-only: valida uuid → 404; `requireRole(req,'curador')` (fail-closed) →
 * 401/403; delega a `dismissReviewImage`. Sem corpo (não há motivo — não é uma ação punitiva).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
): Promise<Response> {
  const { imageId } = await params
  if (!isUuid(imageId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const res = await dismissReviewImage({ db: getDb(), imageId })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
