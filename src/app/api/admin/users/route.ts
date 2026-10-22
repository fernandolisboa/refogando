import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { listAdminUsers } from '@/server/admin/user-list'
import { parseAdminUserListQuery } from '@/domain/admin-user-list'

export const runtime = 'nodejs'

/**
 * Lista de Usuários do Console — admin-only (`requireRole 'admin'`, mesma guarda de `/api/admin/roles`).
 * `GET ?preset=&q=&sort=&page=`; parâmetro desconhecido cai no padrão (ver `parseAdminUserListQuery`). A
 * resposta traz email (dado pessoal, só admin) na allowlist `AdminUserListItem` e vai com `no-store`: nada
 * dela fica em cache de navegador ou CDN.
 */
export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const query = parseAdminUserListQuery(new URL(req.url).searchParams)
  const page = await listAdminUsers(getDb(), query)
  return Response.json(page, { headers: { 'cache-control': 'no-store' } })
}
