import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { requireSession } from '@/server/auth/guard'
import { normalizeHandle } from '@/domain/handle'
import { follow, unfollow, viewerFollows, countFollowers } from '@/server/user/follow'

/**
 * Seguir / deixar de seguir um Cozinheiro (#274, ADR-0024) — `POST`/`DELETE`/`GET`
 * `/api/u/<handle>/follow`. Exige sessão (anon → 401). Assimétrico e SEM aprovação; idempotente.
 *
 * DIVERGÊNCIA DELIBERADA do split `/vote` + `/unvote`: aqui a relação é UMA só (a aresta
 * follower→followee), então `POST` (segue) / `DELETE` (deixa) / `GET` (estado) no MESMO recurso é o
 * shape RESTful natural — e o `GET` de ESTADO é novo de propósito (o perfil é anon-cacheável, então
 * a ilha client busca o "eu sigo?" aqui em vez de receber por SSR). O `GET` é viewer-personalizado →
 * `Cache-Control: no-store` (nunca edge-cacheado como resposta compartilhada).
 *
 * Auto-seguir é barrado no SERVIDOR (422 `auto_seguir`) comparando `session.user.id` ao followee
 * resolvido — ANTES do insert, então o CHECK do banco (`follower <> followee`) é só backstop (nunca
 * 500). O followee é resolvido leak-safe (`normalizeHandle` + `isNull(deleted_at)`, igual a
 * `/api/u/[handle]`): handle inexistente/soft-deletado → 404 (não vaza existência).
 */
export const runtime = 'nodejs'

function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

/** Resolve o followee VIVO pelo handle (mesma normalização + gate soft-delete do perfil público). */
async function resolveFolloweeId(rawHandle: string): Promise<string | null> {
  const handle = normalizeHandle(rawHandle)
  if (handle === null) return null
  const [row] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1)
  return row?.id ?? null
}

type Ctx = { params: Promise<{ handle: string }> }

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const { handle } = await params
  const followeeId = await resolveFolloweeId(handle)
  if (followeeId === null) return notFound()
  const followerId = g.session.user.id
  if (followeeId === followerId) {
    return Response.json({ error: 'auto_seguir' }, { status: 422 })
  }
  const db = getDb()
  await follow(db, followerId, followeeId)
  return Response.json({ isFollowing: true, followerCount: await countFollowers(db, followeeId) })
}

export async function DELETE(request: Request, { params }: Ctx): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const { handle } = await params
  const followeeId = await resolveFolloweeId(handle)
  if (followeeId === null) return notFound()
  const followerId = g.session.user.id
  if (followeeId === followerId) {
    return Response.json({ error: 'auto_seguir' }, { status: 422 })
  }
  const db = getDb()
  await unfollow(db, followerId, followeeId)
  return Response.json({ isFollowing: false, followerCount: await countFollowers(db, followeeId) })
}

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const { handle } = await params
  const followeeId = await resolveFolloweeId(handle)
  if (followeeId === null) return notFound()
  const viewerId = g.session.user.id
  // `isSelf` é computado do `id` da sessão (confiável), não do handle — a ilha esconde o botão com ele
  // (sem depender do cast não-tipado de `session.user.handle`). Próprio perfil ⇒ nunca "seguindo".
  const isSelf = followeeId === viewerId
  const isFollowing = isSelf ? false : await viewerFollows(getDb(), viewerId, followeeId)
  return Response.json({ isFollowing, isSelf }, { headers: { 'cache-control': 'no-store' } })
}
