import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { keepReport } from '@/server/recipe/moderation'

/**
 * Curador MANTÉM a Receita reportada no pool (issue #18). POST curador-only: valida uuid →
 * 404; `requireRole(req,'curador')` (VERBATIM, fail-closed) → 401/403; delega a
 * `keepReport`, que rejeita o report SEM tocar a Receita (permanece no pool). Sem motivo
 * (manter não registra motivo — só remover-do-pool o exige, AC2). `already_resolved` →
 * 409 ja_resolvido (anti-corrida, simétrico a remove).
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

  const res = await keepReport({ db: getDb(), reportId: id, curatorId: g.session.user.id })

  switch (res.kind) {
    case 'ok':
    case 'ok_already_removed':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_reason':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'already_resolved':
      return Response.json({ error: 'ja_resolvido' }, { status: 409 })
  }
}
