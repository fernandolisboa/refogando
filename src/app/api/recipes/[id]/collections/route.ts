import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { loadRecipeCollectionMembership } from '@/server/recipe/collections'

/**
 * Membership do picker de Coleção no detalhe (#364) — `GET /api/recipes/[id]/collections` →
 * `{ saved, collections:[{id,name,contains}] }`, TUDO escopado ao viewer. Route FINO: uuid inválido
 * → 404; `requireSession` ANTES do DB (anônimo ⇒ 401); `session.user.id` HARD-WIRED (anti-IDOR).
 *
 * Retorna 200 para QUALQUER receita-uuid válida (mesmo não salva / inexistente): o picker precisa
 * listar as coleções do PRÓPRIO user pra poder adicionar — `saved` diz se a Receita já está salva, e
 * cada `contains` diz se ela está naquela coleção. Zero leak (só dados do próprio). `no-store`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const { saved, collections } = await loadRecipeCollectionMembership({
    db: getDb(),
    userId: g.session.user.id,
    recipeId: id,
  })
  return Response.json({ saved, collections }, { headers: { 'cache-control': 'no-store' } })
}
