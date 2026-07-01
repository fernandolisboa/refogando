import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applySave } from '@/server/recipe/social'

/**
 * Salvar uma Receita (issue #16/#362, ADR-0003/0027). Route FINO espelhando vote:
 * valida uuid → 404; exige SESSÃO → 401 antes do DB (anônimo = zero efeito, AC6); delega
 * a `applySave(action:'save')` — gate de SALVAR (pool público OU a PRÓPRIA receita mesmo
 * PRIVADA, #362 AC6) + INSERT idempotente. SEM não-autovoto (salvar a própria é permitido).
 * Mapeia o discriminator.
 *
 * Resposta 200: `{ viewerSaved }` (estado do próprio ator — nunca vaza estado alheio).
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

  const res = await applySave({ db: getDb(), id, userId: g.session.user.id, action: 'save' })

  switch (res.kind) {
    case 'ok':
      return Response.json({ viewerSaved: res.viewerSaved }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
