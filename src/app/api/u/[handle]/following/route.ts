import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { normalizeHandle } from '@/domain/handle'
import { listFollowingPage } from '@/server/user/follow'

/**
 * Lista COMPLETA de quem o handle SEGUE, paginada por cursor (#307) — GET
 * `/api/u/<handle>/following?cursor=`. Irmã byte-idêntica de `../followers` (só troca a seam): anon-readable
 * (ADR-0024, Modelo B), NUNCA lê a sessão (nunca 401), page-size SERVER-controlled (`?limit` ignorado),
 * `?cursor` malformado → primeira página (nunca 500), SEM `Cache-Control` e 404 leak-safe. Duas rotas
 * explícitas (≠ um `[kind]` param) seguem a convenção do irmão `/follow` e evitam um branch de validação.
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

  const cursor = new URL(request.url).searchParams.get('cursor')
  const page = await listFollowingPage(db, owner.id, { cursor })
  return Response.json(page)
}
