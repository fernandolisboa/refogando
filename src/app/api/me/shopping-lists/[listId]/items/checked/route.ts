import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyRemoveCheckedShoppingListItems } from '@/server/shopping-list/shopping-list'

/**
 * "Remover marcados" (issue #529, ADR-0032 dec.6) — apaga SÓ os Itens já marcados/comprados
 * (`checked_at` não-nulo) da Lista do próprio usuário; os desmarcados permanecem. Segmento literal
 * `checked` IRMÃO de `items/[itemId]` (precedente: `recipes/import` ao lado de `recipes/[id]` —
 * o literal sempre casa antes do dinâmico). Ação EXPLÍCITA — nada expira sozinho.
 *
 * DELETE → 200 `{ removed }` | 404 not_found (lista de outro/uuid inválido).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> {
  const { listId } = await params
  if (!isUuid(listId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRemoveCheckedShoppingListItems({
    db: getDb(),
    userId: g.session.user.id,
    listId,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true, removed: res.removed }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
