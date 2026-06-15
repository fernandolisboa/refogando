import { APIError } from 'better-auth/api'
import { requireRole } from '@/server/auth/guard'
import { getAuth } from '@/lib/auth'
import { isRole } from '@/domain/user'

/**
 * Promover/rebaixar Usuário (issue #5, #5.AC2/#5.AC5). PUT ADMIN-ONLY: muda o papel de
 * um user via `getAuth().api.setRole` (do plugin admin) e devolve o novo papel. Mudar o
 * papel altera o gating efetivo (um ex-`usuario` virado `curador` passa em /api/curate).
 *
 * Corpo: `{ userId, role }` (role ∈ ROLES). Erros (D8): `papel_invalido` (400) na
 * validação; `papel_nao_aplicado` (status da lib) se o setRole lançar APIError (ex.:
 * userId inexistente); `erro_interno` (500, SEM stack) para qualquer outro lançamento.
 *
 * NOTA: o código HTTP numérico do APIError vem em `e.statusCode` (number). `e.status` é
 * o NOME do status (ex.: 'NOT_FOUND', string) — NÃO usar em `Response`/`{ status }`.
 */
export async function PUT(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown; role?: unknown }
  if (typeof body.userId !== 'string' || typeof body.role !== 'string' || !isRole(body.role)) {
    return Response.json({ error: 'papel_invalido' }, { status: 400 })
  }
  const { userId, role } = body

  // E8 — setRole pode lançar (userId inexistente, papel rejeitado, etc.). Sem try/catch
  // o handler 500aria com stack vazando. Convertemos para um corpo {error} limpo.
  try {
    await getAuth().api.setRole({
      body: { userId, role },
      headers: req.headers,
    })
  } catch (e) {
    if (e instanceof APIError) {
      return Response.json({ error: 'papel_nao_aplicado' }, { status: e.statusCode ?? 400 })
    }
    return Response.json({ error: 'erro_interno' }, { status: 500 })
  }
  return Response.json({ userId, role })
}
