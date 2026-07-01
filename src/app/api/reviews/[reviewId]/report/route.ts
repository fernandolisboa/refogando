import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { createReviewReport } from '@/server/recipe/report'

/**
 * Reportar uma AVALIAÇÃO (issue #366, ADR-0027). Namespace top-level `/api/reviews/[reviewId]/report`
 * DELIBERADO: a Avaliação é globalmente endereçável pelo seu id; o servidor deriva a Receita dona. Route
 * FINO espelhando o report de receita: valida uuid → 404; exige SESSÃO (NÃO papel — qualquer autenticado
 * reporta) → 401 ANTES de tocar o DB; delega a `createReviewReport`, que faz o gate de POOL (só avaliação
 * de receita visível e NÃO-moderada é reportável) + motivo obrigatório + INSERT na fila.
 *
 * Códigos de erro são chaves (i18n visível na UI): `not_found`, `dados_invalidos`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> },
): Promise<Response> {
  const { reviewId } = await params
  if (!isUuid(reviewId)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES do DB: anônimo ⇒ 401, zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''

  const res = await createReviewReport({
    db: getDb(),
    reviewId,
    reporterId: g.session.user.id,
    reason,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ reportId: res.reportId }, { status: 201 })
    case 'invalid_reason':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
