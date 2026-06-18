import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyFavorite } from '@/server/recipe/social'

/**
 * Desfavoritar uma Receita (issue #16, ADR-0003). Route FINO espelhando favorite: valida
 * uuid → 404; exige SESSÃO → 401 antes do DB (anônimo = zero efeito, AC6); delega a
 * `applyFavorite(action:'unfavorite')` — DELETE idempotente (no-op se não favoritou).
 * Mapeia o discriminator.
 *
 * Resposta 200: `{ viewerFavorited:false }`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyFavorite({ db: getDb(), id, userId: g.session.user.id, action: 'unfavorite' })

  switch (res.kind) {
    case 'ok':
      return Response.json({ viewerFavorited: res.viewerFavorited }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
