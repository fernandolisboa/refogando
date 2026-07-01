import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyCollectionRemoveItem } from '@/server/recipe/collections'

/**
 * Remover uma Receita de uma Coleção (#364) — path param, não body (C11: DELETE-com-body é frágil
 * em intermediários). Ambos os ids validados como uuid → 404. `requireSession` ANTES do DB;
 * ownership no core (coleção de outro ⇒ 404). Idempotente e NÃO dessalva (o save é a fonte da
 * verdade — remover-de-coleção ≠ dessalvar).
 *
 * DELETE → 200 | 404 not_found.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ collectionId: string; recipeId: string }> },
): Promise<Response> {
  const { collectionId, recipeId } = await params
  if (!isUuid(collectionId) || !isUuid(recipeId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyCollectionRemoveItem({
    db: getDb(),
    userId: g.session.user.id,
    collectionId,
    recipeId,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
