import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyCatalogImageSelect } from '@/server/curate/catalog-image'

/**
 * POST /api/curate/recipes/[id]/images/[imageId]/select — escolhe uma imagem da galeria como face de
 * um rascunho de CATÁLOGO (#238, ADR-0026 emenda dec.10). Curador-only; gate `origin='catalog'` (404
 * leak-safe). Imagem moderada (#225) NÃO vira face ⇒ 409. Devolve a galeria atualizada.
 */
export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const { id, imageId } = await params
  if (!isUuid(id) || !isUuid(imageId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const res = await applyCatalogImageSelect({ db: getDb(), id, imageId })
  switch (res.kind) {
    case 'ok':
      return Response.json({ gallery: res.gallery }, { status: 200 })
    case 'moderated':
      return Response.json({ error: 'imagem_moderada' }, { status: 409 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
