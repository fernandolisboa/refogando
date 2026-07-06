import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyToggleShoppingListItemChecked } from '@/server/shopping-list/shopping-list'

/**
 * Check-off de UM Item da Lista (issue #529, ADR-0032 dec.6) — PERSISTENTE, nunca expira sozinho.
 * Route FINO, espelha `me/collections/[collectionId]/route.ts`: uuid inválido (lista OU item) →
 * 404 (leak-safe); `requireSession` ANTES do DB; ownership (lista do usuário + item pertence a
 * essa lista) resolvido no core, ambos colapsam no MESMO `not_found`.
 *
 * PATCH {checked: boolean} → marca (checked_at = now()) ou desmarca (checked_at = null). O corpo
 * manda o ESTADO-ALVO (não um toggle cego) — idempotente sob duplo-clique/retry.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
): Promise<Response> {
  const { listId, itemId } = await params
  if (!isUuid(listId) || !isUuid(itemId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { checked?: unknown }
  if (typeof body.checked !== 'boolean') {
    return Response.json({ error: 'checked_invalido' }, { status: 400 })
  }

  const res = await applyToggleShoppingListItemChecked({
    db: getDb(),
    userId: g.session.user.id,
    listId,
    itemId,
    checked: body.checked,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true, checkedAt: res.checkedAt }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
