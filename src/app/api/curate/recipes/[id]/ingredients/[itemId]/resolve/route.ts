import { eq } from 'drizzle-orm'
import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { isUuid } from '@/server/http/params'
import { resolveItem } from '@/server/curate/resolve-item'

/**
 * POST /api/curate/recipes/[id]/ingredients/[itemId]/resolve — resolve um Item raw →
 * Ingrediente canônico (issue #19, AC2). UPDATE puro: acende a busca cross-locale de #9
 * AO VIVO, sem stale/re-embed.
 *
 * Ordem de guards (espelha review/route.ts): isUuid→404, requireRole→401/403, gate de
 * escopo origin='catalog' (404 leak-safe — Curador não resolve Itens de comunidade por
 * aqui), validação do body.ingredientId, depois o efeito.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<Response> {
  const { id, itemId } = await params
  if (!isUuid(id) || !isUuid(itemId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const db = getDb()

  // Gate de escopo: existe E origin='catalog' (404 leak-safe; não vaza existência de
  // receita de comunidade, e não autoriza WRITE em comunidade pelo endpoint de catálogo).
  const [gate] = await db.select({ origin: recipe.origin }).from(recipe).where(eq(recipe.id, id))
  if (!gate || gate.origin !== 'catalog') return Response.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { ingredientId?: unknown }
  if (typeof body.ingredientId !== 'string' || !isUuid(body.ingredientId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const ok = await resolveItem(db, { recipeId: id, itemId, ingredientId: body.ingredientId })
  if (!ok) return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({ ok: true }, { status: 200 })
}
