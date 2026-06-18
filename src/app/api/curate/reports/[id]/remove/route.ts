import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { applyModerationRemove } from '@/server/recipe/moderation'

/**
 * Curador REMOVE a Receita reportada do pool (issue #18, AC2/AC3). POST curador-only: valida
 * uuid → 404; `requireRole(req,'curador')` (VERBATIM, fail-closed) → 401/403; motivo
 * obrigatório no body (AC2); delega a `applyModerationRemove`. Remover-do-pool é exclusão
 * LÓGICA de moderação — NÃO toca `visibility` (≠ despublicar, AC3) nem conteúdo (AC5).
 *
 * `ok` e `ok_already_removed` mapeiam ambos 200 (o cliente vê sucesso; a distinção
 * preserva a proveniência da 1ª remoção e é auditável internamente). `already_resolved` →
 * 409 (honesto sobre a corrida, não 200-noop). Códigos: `papel_insuficiente`, `not_found`,
 * `dados_invalidos`, `ja_resolvido` (i18n visível na UI #63).
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

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''

  const res = await applyModerationRemove({
    db: getDb(),
    reportId: id,
    curatorId: g.session.user.id,
    reason,
  })

  switch (res.kind) {
    case 'ok':
    case 'ok_already_removed':
      return Response.json({ ok: true }, { status: 200 })
    case 'invalid_reason':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'already_resolved':
      return Response.json({ error: 'ja_resolvido' }, { status: 409 })
  }
}
