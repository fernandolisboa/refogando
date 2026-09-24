import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import {
  applyEditShoppingListItemQuantidade,
  applyRemoveShoppingListItem,
  applyToggleShoppingListItemChecked,
} from '@/server/shopping-list/shopping-list'

/**
 * UMA linha de UMA Lista de compras — check-off PERSISTENTE (issue #529, ADR-0032 dec.6) + edição à
 * mão (issue #528, dec.5). Route FINO, espelha `me/collections/[collectionId]/items/[recipeId]`: os
 * DOIS ids validados como uuid → 404 (leak-safe); `requireSession` ANTES do DB; ownership da Lista
 * + pertencimento do Item a ELA resolvidos no core — ambos ⇒ o MESMO `not_found`, nunca revela qual
 * dos dois falhou.
 *
 * PATCH DISCRIMINA pelo corpo (o mesmo verbo "editar esta linha", dois campos independentes de duas
 * fatias que coexistem na MESMA linha):
 *   - `{ checked: boolean }` → marca/desmarca comprado (dec.6, PERSISTENTE; o corpo manda o
 *     ESTADO-ALVO, não um toggle cego — idempotente sob duplo-clique/retry). 200 `{ ok, checkedAt }`
 *     | 400 checked_invalido | 404 not_found.
 *   - `{ quantidade: string | null }` → edita a quantidade (dec.5); `null` limpa (linha vira "sem
 *     número"), string precisa bater o formato numeric(10,3) POSITIVO. 200 | 400 quantidade_invalida
 *     | 404 not_found. Só a quantidade muda — nome/unidade não são editáveis aqui (mudariam a chave
 *     de agregação da linha).
 *   - nenhum dos dois presente → 400 corpo_invalido.
 * DELETE → remove a linha (dec.5). 200 | 404 not_found.
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

  const body = (await request.json().catch(() => ({}))) as { checked?: unknown; quantidade?: unknown }

  // Check-off (#529, dec.6): discriminado pela presença de `checked` (tem precedência).
  if (body.checked !== undefined) {
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

  // Editar quantidade (#528, dec.5): `quantidade` pode ser `null` (limpa) ou uma string numérica.
  if (body.quantidade !== undefined) {
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

  // Corpo sem `checked` nem `quantidade`: nada a fazer.
  return Response.json({ error: 'corpo_invalido' }, { status: 400 })
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
