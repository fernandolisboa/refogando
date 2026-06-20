import { requireSession } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { applyRecipeImageUpload, applyRecipeImageRemoval } from '@/server/recipe/image'

/**
 * Imagem da receita (#130, ADR-0016) — o Owner sobe/troca/remove a foto do prato. Route FINO:
 * valida uuid + multipart, exige sessão, delega ao núcleo (`server/recipe/image.ts`), mapeia o
 * discriminator. Autorização é OWNERSHIP (catálogo/não-dono ⇒ 404, NUNCA 403 — ADR-0011); o núcleo
 * a reimpõe. A imagem vira ENTIDADE `recipe_image` (`user_photo`), ref-counted (ver o núcleo).
 *
 * Ordem dos guards (load-bearing, espelha publish): `isUuid` (sem DB) → `requireSession` ANTES de
 * tocar o DB/storage (sem-sessão ⇒ zero efeito) → validação do arquivo → delega.
 *
 * POST (multipart `file`): valida tipo (jpg/png/webp) + tamanho (rede do servidor; o cliente já
 * redimensiona). 200 com a view atualizada; 503 `storage_indisponivel` se o seam de storage cair.
 * DELETE: remove a foto (idempotente). 200 com a view.
 */

export const runtime = 'nodejs' // postgres-js + Buffer exigem Node, não Edge.

/** Cap de tamanho do upload (2 MB) — espelha o avatar; o cliente redimensiona p/ bem abaixo. */
const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'arquivo_ausente' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'arquivo_ausente' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type)) return Response.json({ error: 'tipo_invalido' }, { status: 400 })
  if (file.size > MAX_BYTES) return Response.json({ error: 'arquivo_grande' }, { status: 400 })

  const data = Buffer.from(await file.arrayBuffer())
  const res = await applyRecipeImageUpload({
    db: getDb(),
    store: getImageStore(),
    id,
    userId: g.session.user.id,
    data,
    contentType: file.type,
    requestLocale: parseRequestLocale(request),
  })

  return mapResult(res)
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRecipeImageRemoval({
    db: getDb(),
    store: getImageStore(),
    id,
    userId: g.session.user.id,
    requestLocale: parseRequestLocale(request),
  })

  return mapResult(res)
}

/** Mapeia o discriminator do núcleo para HTTP (compartilhado por POST e DELETE). */
function mapResult(res: Awaited<ReturnType<typeof applyRecipeImageUpload>>): Response {
  switch (res.kind) {
    case 'ok':
      return Response.json(res.view, { status: 200 })
    case 'storage':
      return Response.json({ error: 'storage_indisponivel' }, { status: 503 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
