import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { createReport } from '@/server/recipe/report'

/**
 * Reportar uma Receita do pool (issue #18, AC1). Route FINO espelhando vote: valida uuid →
 * 404; exige SESSÃO (NÃO papel — qualquer Usuário autenticado reporta) → 401 ANTES de tocar
 * o DB (anônimo = zero efeito); delega a `createReport`, que faz o gate de POOL (só receita
 * visível é reportável) + motivo obrigatório + INSERT na fila. Mapeia o discriminator.
 *
 * Códigos de erro são chaves (i18n visível na UI #63): `nao_autenticado`, `not_found`,
 * `dados_invalidos`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  // Sessão ANTES do DB: anônimo ⇒ 401, zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
  const reason = typeof body.reason === 'string' ? body.reason : ''

  const res = await createReport({ db: getDb(), id, userId: g.session.user.id, reason })

  switch (res.kind) {
    case 'ok':
      return Response.json({ reportId: res.reportId }, { status: 201 })
    case 'invalid_reason':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
