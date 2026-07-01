import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { loadViewerReview } from '@/server/recipe/review'

/**
 * Estado da PRÓPRIA Avaliação do viewer — `GET /api/recipes/[id]/reviews/mine` →
 * `{ viewerReview, isOwner }`. EXISTE porque o caminho PÚBLICO/cacheável do detalhe (ADR-0020)
 * lê ANÔNIMO (sem cookie) e não personaliza; a `RecipeReviewSection` (client) bate aqui quando
 * logada pra prefill/editar a própria avaliação ou esconder o widget do dono.
 *
 * Route FINO espelhando `/social`: uuid inválido → 404; SESSÃO → 401 ANTES do DB; pool-gate
 * LEAK-SAFE → 404. `userId` HARD-WIRED de `session.user.id` (anti-IDOR); nunca vaza avaliação
 * alheia. `Cache-Control: no-store` (per-viewer, nunca edge-cacheável como resposta compartilhada).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await loadViewerReview(getDb(), { id, userId: g.session.user.id })
  if (res.kind === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })

  // #365: `viewerReview` já inclui `photoUrl` (prefill do preview ao editar a própria avaliação).
  return Response.json(
    { viewerReview: res.viewerReview, isOwner: res.isOwner, moderated: res.moderated },
    { headers: { 'cache-control': 'no-store' } },
  )
}
