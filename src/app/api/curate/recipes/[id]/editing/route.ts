import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { startEditingCatalogRecipe } from '@/server/curate/recipe-curation'

/**
 * Marcar EM EDIÇÃO um rascunho de catálogo (#238, ADR-0026) — `POST /api/curate/recipes/[id]/editing`.
 * Curador-only. pending → editing (triagem: o Curador começou a refinar). Idempotente. Continua
 * ESCONDIDO. Valida uuid → 404; `requireRole` fail-closed; delega a `startEditingCatalogRecipe`.
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

  const res = await startEditingCatalogRecipe({ db: getDb(), recipeId: id })
  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_state':
      return Response.json({ error: 'estado_invalido' }, { status: 409 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
