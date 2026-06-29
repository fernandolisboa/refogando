import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { approveCatalogRecipe } from '@/server/curate/recipe-curation'

/**
 * APROVAR um rascunho de catálogo (#238, ADR-0026) — `POST /api/curate/recipes/[id]/approve`.
 * Curador-only. pending|editing → approved: vai ao público + promove o original_locale + embeda.
 * Valida uuid → 404; `requireRole` fail-closed; delega a `approveCatalogRecipe` (guarda owner-null +
 * estado). Espelha o contrato de `review-images/[imageId]/remove`.
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

  const res = await approveCatalogRecipe({ db: getDb(), recipeId: id, curatorId: g.session.user.id })
  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_state':
      return Response.json({ error: 'estado_invalido' }, { status: 409 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
