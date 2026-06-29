import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { rejectCatalogRecipe } from '@/server/curate/recipe-curation'

/**
 * REJEITAR um rascunho de catálogo (#238, ADR-0026) — `POST /api/curate/recipes/[id]/reject`.
 * Curador-only. pending|editing → rejected (TOMBSTONE: guardado, nunca público, fora da fila ativa).
 * Body `{ note?: string }` registra o motivo (review_note, opcional). Valida uuid → 404; `requireRole`
 * fail-closed; delega a `rejectCatalogRecipe`.
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

  const body = (await request.json().catch(() => ({}))) as { note?: unknown }
  const note = typeof body.note === 'string' ? body.note : null

  const res = await rejectCatalogRecipe({ db: getDb(), recipeId: id, curatorId: g.session.user.id, note })
  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_state':
      return Response.json({ error: 'estado_invalido' }, { status: 409 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
