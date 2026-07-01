import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyCollectionDelete, applyCollectionRename } from '@/server/recipe/collections'

/**
 * Renomear / apagar UMA Coleção do próprio usuário (#364). Route FINO: uuid inválido → 404
 * (leak-safe, indistinguível de "não existe"); `requireSession` ANTES do DB; ownership resolvido
 * no core por (id, user_id) — coleção de outro ⇒ 404.
 *
 * PATCH {name} → 200 | 400 nome_invalido | 409 nome_duplicado | 404 not_found.
 * DELETE → 200 | 404 not_found. (Apagar limpa os itens via cascade; NÃO dessalva.)
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
): Promise<Response> {
  const { collectionId } = await params
  if (!isUuid(collectionId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { name?: unknown }
  if (typeof body.name !== 'string') {
    return Response.json({ error: 'nome_invalido' }, { status: 400 })
  }

  const res = await applyCollectionRename({
    db: getDb(),
    userId: g.session.user.id,
    collectionId,
    name: body.name,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_name':
      return Response.json({ error: 'nome_invalido' }, { status: 400 })
    case 'duplicate_name':
      return Response.json({ error: 'nome_duplicado' }, { status: 409 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
): Promise<Response> {
  const { collectionId } = await params
  if (!isUuid(collectionId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyCollectionDelete({
    db: getDb(),
    userId: g.session.user.id,
    collectionId,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
