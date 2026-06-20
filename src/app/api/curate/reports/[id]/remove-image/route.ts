import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyImageModeration } from '@/server/recipe/moderation'

/**
 * Curador REMOVE SÓ A IMAGEM da Receita reportada (issue #133, ADR-0016) — esconde a imagem do
 * público SEM derrubar a Receita do pool. POST curador-only: valida uuid → 404; `requireRole(req,
 * 'curador')` (fail-closed) → 401/403; motivo obrigatório; delega a `applyImageModeration`. Eixo
 * ORTOGONAL a `.../remove` (remover-a-Receita-do-pool, #18). Espelha o contrato do remove.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''

  const res = await applyImageModeration({
    db: getDb(),
    reportId: id,
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
    case 'already_resolved':
      return Response.json({ error: 'ja_resolvido' }, { status: 409 })
    case 'no_image':
      return Response.json({ error: 'sem_imagem' }, { status: 422 })
  }
}
