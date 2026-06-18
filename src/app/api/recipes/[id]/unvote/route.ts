import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyVote } from '@/server/recipe/social'

/**
 * Desfazer o voto (issue #16, ADR-0003). Route FINO espelhando vote: valida uuid → 404;
 * exige SESSÃO → 401 antes do DB (anônimo = zero efeito, AC6); delega a
 * `applyVote(action:'unvote')` — DELETE idempotente (no-op se não votou; desfazer sempre
 * permitido, sem não-autovoto). Mapeia o discriminator.
 *
 * Resposta 200: `{ voteCount, viewerVoted:false }`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyVote({ db: getDb(), id, userId: g.session.user.id, action: 'unvote' })

  switch (res.kind) {
    case 'ok':
      return Response.json({ voteCount: res.voteCount, viewerVoted: res.viewerVoted }, { status: 200 })
    case 'auto_voto':
      // Inalcançável em unvote (desfazer não checa não-autovoto), mas o switch é exaustivo.
      return Response.json({ error: 'auto_voto' }, { status: 422 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
