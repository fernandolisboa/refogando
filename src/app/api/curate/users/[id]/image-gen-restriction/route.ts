import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { setImageGenRestriction } from '@/server/curate/restriction'

/**
 * Curador BLOQUEIA/DESBLOQUEIA a geração de imagem por IA de um Usuário (#226, ADR-0022 dec.3 / 1º
 * gancho do ADR-0007) — `POST /api/curate/users/[id]/image-gen-restriction`. Restrição GRANULAR
 * (só a geração-por-IA do usuário, não a conta inteira — distinta do ban deferido). Curador-only:
 * valida uuid → 404; `requireRole(req, 'curador')` (fail-closed → 401/403); body
 * `{ blocked: boolean, reason?: string }`; delega a `setImageGenRestriction`. Espelha o contrato do
 * `reports/[id]/remove-image`. Bloquear exige motivo (400 dados_invalidos se vazio); desbloquear não.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { blocked?: unknown; reason?: unknown }
  if (typeof body.blocked !== 'boolean') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const res = await setImageGenRestriction({
    db: getDb(),
    curatorId: g.session.user.id,
    targetUserId: id,
    blocked: body.blocked,
    reason,
  })

  switch (res.kind) {
    case 'ok':
    case 'ok_already_blocked':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_reason':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
