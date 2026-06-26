import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { normalizeHandle } from '@/domain/handle'
import { listFollowersPage } from '@/server/user/follow'

/**
 * Lista COMPLETA de SEGUIDORES paginada por cursor (#307) — GET `/api/u/<handle>/followers?cursor=`.
 * ANÔNIMA-readable (ADR-0024, Modelo B/ADR-0020): grafo de seguir é PÚBLICO e viewer-INDEPENDENTE, então
 * esta rota NUNCA lê a sessão (`getDb()` não toca cookies) ⇒ nunca 401, e o modal client busca on-demand
 * sem seed SSR. Espelha `/api/u/[handle]`: route fino, resolve o dono leak-safe e delega à seam.
 *
 * O page-size é SERVER-controlled (`FOLLOW_LIST_PREVIEW`, dentro da seam) — qualquer `?limit=` é IGNORADO
 * (anti-abuso do DTO). `?cursor=` malformado decodifica pra `null` na seam ⇒ primeira página, nunca 500.
 * SEM `Cache-Control` (igual a `/api/u/[handle]`): só rotas viewer-personalizadas marcam `no-store` — aqui
 * não cabe um header `s-maxage` que serviria uma lista velha logo após um follow.
 *
 * 404 leak-safe: handle inexistente OU conta soft-deletada (`deleted_at IS NULL` no gate) → `not_found`,
 * sem distinguir os dois. Normalização (`normalizeHandle`) idêntica à da gravação (#128) e ao perfil.
 */
export const runtime = 'nodejs'

function notFound(): Response {
  return Response.json({ error: 'not_found' }, { status: 404 })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const { handle: rawHandle } = await params
  const handle = normalizeHandle(rawHandle)
  if (handle === null) return notFound()

  const db = getDb()
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.handle, handle), isNull(users.deletedAt)))
    .limit(1)
  if (!owner) return notFound()

  // `?cursor` é o ÚNICO parâmetro lido; `?limit` é deliberadamente ignorado (page-size é da seam).
  const cursor = new URL(request.url).searchParams.get('cursor')
  const page = await listFollowersPage(db, owner.id, { cursor })
  return Response.json(page)
}
