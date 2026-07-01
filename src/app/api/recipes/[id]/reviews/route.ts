import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyReview, loadRecipeReviews } from '@/server/recipe/review'

/**
 * Avaliação de uma Receita do pool (issue #363, ADR-0027). Routes FINOS espelhando vote/report.
 *
 * POST/PUT (ambos = upsert/salvar; PUT é alias semântico): valida uuid → 404; exige SESSÃO → 401
 * ANTES do DB (anônimo = zero efeito); parse defensivo do body (malformado ⇒ 400, nunca 500);
 * delega a `applyReview(action:'save')` que faz gate de POOL + decideReview (nota/comentário/
 * auto-avaliação) + upsert. DELETE: apaga a própria (idempotente). GET: COOKIE-FREE/cacheável
 * (sem requireSession, sem no-store) — agregado + lista pública; fora do pool ⇒ 404 leak-safe.
 *
 * Códigos de erro são chaves (i18n na UI): `dados_invalidos` (400), `auto_avaliacao` (422),
 * `not_found` (404), `nao_autenticado`/`conta_desativada` (401 via requireSession).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

async function handleSave(request: Request, id: string): Promise<Response> {
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { rating?: unknown; comment?: unknown }
  const rating = typeof body.rating === 'number' ? body.rating : NaN

  const res = await applyReview({
    db: getDb(),
    id,
    userId: g.session.user.id,
    action: 'save',
    rating,
    comment: body.comment,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(
        {
          average: res.average,
          count: res.count,
          viewerRating: res.viewerRating,
          viewerComment: res.viewerComment,
        },
        { status: 200 },
      )
    case 'invalid_rating':
    case 'invalid_comment':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'auto_review':
      return Response.json({ error: 'auto_avaliacao' }, { status: 422 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  return handleSave(request, id)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  return handleSave(request, id)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyReview({ db: getDb(), id, userId: g.session.user.id, action: 'delete' })
  switch (res.kind) {
    case 'ok':
      return Response.json(
        { average: res.average, count: res.count, viewerRating: null, viewerComment: null },
        { status: 200 },
      )
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    // save-only kinds nunca ocorrem no delete; exaustividade satisfeita.
    default:
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const res = await loadRecipeReviews(getDb(), { id })
  if (res == null) return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({ average: res.average, count: res.count, reviews: res.reviews })
}
