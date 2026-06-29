import { requireRole } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import {
  applyCatalogImageUpload,
  applyCatalogImageRemoval,
  type CatalogImageResult,
} from '@/server/curate/catalog-image'

/**
 * POST/DELETE /api/curate/recipes/[id]/image — sobe foto / deseleciona a face de um rascunho de
 * CATÁLOGO (#238, ADR-0026 emenda dec.10). Curador-only; gate `origin='catalog'` (404 leak-safe).
 * Espelha a rota de DONO (`/api/recipes/[id]/image`) mas autoriza por papel, não posse. POST
 * (multipart `file`, jpg/png/webp ≤2MB) acrescenta à galeria + AUTO-SELECIONA; DELETE deseleciona
 * (volta ao placeholder, não apaga). `requireRole` ANTES de tocar DB/storage.
 */
export const runtime = 'nodejs' // postgres-js + Buffer exigem Node, não Edge.

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return Response.json({ error: 'arquivo_ausente' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'arquivo_ausente' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: 'tipo_invalido' }, { status: 400 })
  if (file.size > MAX_BYTES) return Response.json({ error: 'arquivo_grande' }, { status: 400 })

  const data = Buffer.from(await file.arrayBuffer())
  const res = await applyCatalogImageUpload({
    db: getDb(),
    store: getImageStore(),
    id,
    curatorId: g.session.user.id,
    data,
    contentType: file.type,
  })
  return mapResult(res)
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(req, 'curador')
  if (!g.ok) return g.response

  const res = await applyCatalogImageRemoval({ db: getDb(), id })
  return mapResult(res)
}

function mapResult(res: CatalogImageResult): Response {
  switch (res.kind) {
    case 'ok':
      return Response.json({ gallery: res.gallery }, { status: 200 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
