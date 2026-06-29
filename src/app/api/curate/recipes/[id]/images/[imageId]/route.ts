import { requireRole } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyCatalogGalleryImageDelete } from '@/server/curate/catalog-image'

/**
 * DELETE /api/curate/recipes/[id]/images/[imageId] — apaga uma imagem da galeria de um rascunho de
 * CATÁLOGO (#238, ADR-0026 emenda dec.10). Curador-only; gate `origin='catalog'` (404 leak-safe).
 * Bloqueada (409 in_use) se ALGUMA versão ainda referencia a imagem como face (ref-count GLOBAL,
 * ADR-0016). Devolve a galeria atualizada.
 */
export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const { id, imageId } = await params
  if (!isUuid(id) || !isUuid(imageId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const res = await applyCatalogGalleryImageDelete({ db: getDb(), store: getImageStore(), id, imageId })
  switch (res.kind) {
    case 'ok':
      return Response.json({ gallery: res.gallery }, { status: 200 })
    case 'in_use':
      return Response.json({ error: 'imagem_em_uso' }, { status: 409 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
