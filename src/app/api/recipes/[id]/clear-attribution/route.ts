import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { clearSourceAttribution } from '@/server/recipe/clear-attribution'

/**
 * Remover o nome da fonte de uma Receita importada (#272 LGPD, ADR-0019). Route FINO: valida uuid,
 * exige sessão, delega ao módulo server, mapeia o discriminator.
 *
 * Ordem dos guards (espelha publish): `isUuid` antes da sessão (não toca DB; 404 p/ id malformado),
 * `requireSession` ANTES de qualquer acesso ao DB (sem-sessão ⇒ ZERO efeito). Autorização é OWNERSHIP:
 * não-dono/catálogo ⇒ 404, NUNCA 403 (ADR-0011 — não vaza existência).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES de tocar o DB: sem-sessão ⇒ zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const requestLocale = parseRequestLocale(request)

  const res = await clearSourceAttribution({
    db: getDb(),
    id,
    userId: g.session.user.id,
    requestLocale,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(res.view, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
