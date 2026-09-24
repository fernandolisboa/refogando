import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { applyShoppingListCreate, loadShoppingLists } from '@/server/shopping-list/shopping-list'

/**
 * Listas de compras do PRÓPRIO usuário (issue #525, ADR-0032 dec.1) — container, espelha
 * `me/collections`: `requireSession` ANTES do DB (Visitante ⇒ 401, zero efeito); GET per-viewer
 * com `cache-control: no-store` (resposta pessoal, nunca cacheável compartilhada). LEAK-SAFE por
 * construção: os loaders escopam por `session.user.id` (HARD-WIRED, nunca de query).
 *
 * GET → `{ lists: ShoppingListSummary[] }` (id, name, createdAt, updatedAt, itemCount), por nome.
 * POST {name} → 200 `{ list }` | 400 nome_invalido | 409 nome_duplicado | 422 limite_listas.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const lists = await loadShoppingLists({ db: getDb(), userId: g.session.user.id })
  return Response.json({ lists }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof body.name !== 'string') {
    return Response.json({ error: 'nome_invalido' }, { status: 400 })
  }

  const res = await applyShoppingListCreate({
    db: getDb(),
    userId: g.session.user.id,
    name: body.name,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ list: res.list }, { status: 200 })
    case 'invalid_name':
      return Response.json({ error: 'nome_invalido' }, { status: 400 })
    case 'duplicate_name':
      return Response.json({ error: 'nome_duplicado' }, { status: 409 })
    case 'limit_reached':
      return Response.json({ error: 'limite_listas' }, { status: 422 })
  }
}
