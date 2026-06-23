import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { applyRecipeImageSelect } from '@/server/recipe/image'

/**
 * SELECIONAR uma imagem da galeria como face pública (#222, ADR-0022 dec.1) —
 * `POST /api/recipes/[id]/images/[imageId]/select`. "Usar esta" (após um preview) / re-selecionar
 * uma antiga. Owner-only; custo ZERO (só repointa `recipe.image_id`, sem ledger/reap). Leak-safe
 * (ADR-0011): UM 404 para não-dono/catálogo, imageId inexistente, e imagem de OUTRA linhagem (nunca
 * distingue, nunca 403). 200 com a view atualizada.
 *
 * Ordem dos guards: `isUuid` (sem DB, ambos os ids) → `requireSession` ANTES do DB → delega.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const { id, imageId } = await params
  if (!isUuid(id) || !isUuid(imageId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRecipeImageSelect({
    db: getDb(),
    id,
    userId: g.session.user.id,
    imageId,
    requestLocale: parseRequestLocale(request),
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(res.view, { status: 200 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
