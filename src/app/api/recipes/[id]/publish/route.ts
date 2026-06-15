import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { applyVisibilityTransition } from '@/server/recipe/visibility'

/**
 * Publicar a Receita (issue #13, §2.3): private→public, self-publish sem curadoria,
 * entra no pool com atribuição = `owner_id` existente. Route FINO: valida uuid, exige
 * sessão, delega ao módulo server com `target='public'`, mapeia o discriminator.
 *
 * Ordem dos guards é load-bearing: `requireSession` ANTES de qualquer acesso ao DB ⇒
 * sem-sessão garante ZERO efeito colateral (sustenta a história de sessão expirada +
 * idempotência da re-emissão). `isUuid` antes da sessão é OK (não toca DB; mantém 404
 * para id malformado mesmo logado — espelha o GET).
 *
 * Autorização é ownership (não papel): não-dono/catálogo ⇒ 404, NUNCA 403 (ADR-0011).
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

  const res = await applyVisibilityTransition({
    db: getDb(),
    id,
    userId: g.session.user.id,
    target: 'public',
    requestLocale,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(res.view, { status: 200 })
    case 'playful':
      return Response.json({ error: 'playful_nao_publicavel' }, { status: 422 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
