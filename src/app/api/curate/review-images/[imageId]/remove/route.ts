import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyReviewImageModeration } from '@/server/curate/review'

/**
 * Curador REMOVE uma imagem da fila proativa (#227, ADR-0022 dec.3) = MODERAR a imagem DIRETO por
 * imageId (#133) — esconde do público (placeholder) SEM tocar a Receita, e a tira da fila. POST
 * curador-only: valida uuid → 404; `requireRole(req,'curador')` (fail-closed) → 401/403; motivo
 * obrigatório (400 dados_invalidos se vazio); delega a `applyReviewImageModeration`. Espelha o
 * contrato do `reports/[id]/remove-image`, mas keyed por imageId (sem Report).
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

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''

  const res = await applyReviewImageModeration({
    db: getDb(),
    imageId,
    curatorId: g.session.user.id,
    reason,
  })

  switch (res.kind) {
    case 'ok':
    case 'ok_already_moderated':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_reason':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
