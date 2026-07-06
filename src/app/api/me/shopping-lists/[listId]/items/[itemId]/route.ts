import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import {
  applyEditShoppingListItemQuantidade,
  applyRemoveShoppingListItem,
} from '@/server/shopping-list/shopping-list'

/**
 * UMA linha de UMA Lista de compras (issue #528, ADR-0032 dec.5 — edição à mão). Route FINO,
 * espelha `me/collections/[collectionId]/items/[recipeId]`: os DOIS ids validados como uuid → 404
 * (leak-safe); `requireSession` ANTES do DB; ownership da Lista + pertencimento do Item a ELA
 * resolvidos no core (`applyEditShoppingListItemQuantidade`/`applyRemoveShoppingListItem`) — ambos
 * ⇒ o MESMO `not_found`, nunca revela qual dos dois falhou.
 *
 * PATCH {quantidade} → 200 | 400 quantidade_invalida | 404 not_found. `quantidade: null` limpa (a
 * linha vira "sem número"); string precisa bater o formato numeric(10,3) positivo. Só a quantidade
 * muda — nome/unidade não são editáveis aqui (mudariam a chave de agregação da linha).
 * DELETE → 200 | 404 not_found.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
): Promise<Response> {
  const { listId, itemId } = await params
  if (!isUuid(listId) || !isUuid(itemId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { quantidade?: unknown }
  if (body.quantidade !== null && typeof body.quantidade !== 'string') {
    return Response.json({ error: 'quantidade_invalida' }, { status: 400 })
  }

  const res = await applyEditShoppingListItemQuantidade({
    db: getDb(),
    userId: g.session.user.id,
    listId,
    itemId,
    quantidade: body.quantidade,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_quantidade':
      return Response.json({ error: 'quantidade_invalida' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
): Promise<Response> {
  const { listId, itemId } = await params
  if (!isUuid(listId) || !isUuid(itemId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRemoveShoppingListItem({
    db: getDb(),
    userId: g.session.user.id,
    listId,
    itemId,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
