import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { applyRecipeGalleryImageDelete } from '@/server/recipe/image'

/**
 * APAGAR uma imagem da galeria (#222, ADR-0022 dec.1) — `DELETE /api/recipes/[id]/images/[imageId]`.
 * A ÚNICA op destrutiva: apaga a linha `recipe_image` + reapa o blob. Owner-only; alcance
 * LINHAGEM-escopado (a imagem deve ser membro da galeria desta Receita, senão 404 leak-safe). Bloqueia
 * com `in_use` (409) quando ALGUMA versão ainda a referencia como face (ref-count GLOBAL, ADR-0016).
 * 200 com a view atualizada no sucesso.
 *
 * Ordem dos guards: `isUuid` (sem DB, ambos os ids) → `requireSession` ANTES do DB → delega.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const { id, imageId } = await params
  if (!isUuid(id) || !isUuid(imageId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRecipeGalleryImageDelete({
    db: getDb(),
    store: getImageStore(),
    id,
    userId: g.session.user.id,
    imageId,
    requestLocale: parseRequestLocale(request),
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(res.view, { status: 200 })
    case 'in_use':
      // #222: ainda é a face de alguma versão (US26) — bloqueia com 409 + mensagem amigável na UI.
      return Response.json({ error: 'in_use' }, { status: 409 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
