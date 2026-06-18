import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyVote } from '@/server/recipe/social'

/**
 * Votar numa Receita do pool (issue #16, ADR-0003). Route FINO espelhando publish:
 * valida uuid → 404; exige SESSÃO (não papel — voto não depende de papel; requireRole
 * tem caminho fail-open) → 401 ANTES de tocar o DB (anônimo = zero efeito, AC6); delega
 * a `applyVote(action:'vote')`, que faz o gate de POOL (não de ownership — Catálogo é
 * votável) + não-autovoto (AC2) + INSERT idempotente (AC1). Mapeia o discriminator.
 *
 * Resposta 200: `{ voteCount, viewerVoted }` (camelCase, espelha RecipeView). `viewerVoted`
 * é o estado do PRÓPRIO ator autenticado — nunca vaza estado alheio.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES do DB: anônimo ⇒ 401, zero efeito colateral (AC6).
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyVote({ db: getDb(), id, userId: g.session.user.id, action: 'vote' })

  switch (res.kind) {
    case 'ok':
      return Response.json({ voteCount: res.voteCount, viewerVoted: res.viewerVoted }, { status: 200 })
    case 'auto_voto':
      return Response.json({ error: 'auto_voto' }, { status: 422 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
