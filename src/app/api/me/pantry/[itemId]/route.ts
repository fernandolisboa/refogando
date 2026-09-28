import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyRemovePantryItem } from '@/server/pantry/pantry'

/**
 * Tira UM item da Despensa do próprio usuário (ADR-0038).
 *
 * DELETE → 200 `{ ok: true }` | 404 not_found (item de outro, inexistente ou uuid inválido — leak-safe).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function DELETE(request: Request, { params }: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const { itemId } = await params
  if (!isUuid(itemId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRemovePantryItem({
    db: getDb(),
    userId: g.session.user.id,
    itemId,
  })
  if (res.kind === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ ok: true }, { status: 200 })
}
