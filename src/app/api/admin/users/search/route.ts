import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { searchUsers } from '@/server/user/search'
import { projectAdminUserResult } from '@/domain/user-search-read'

export const runtime = 'nodejs'

/**
 * Busca de usuários p/ atribuição de Papéis (#269) — admin-only (`requireRole 'admin'`, mesma
 * guarda do PUT /api/admin/roles). `GET ?q=` por nome/@handle/email/ID. Como é admin, chama o seam
 * com `includeEmail=true`: pesquisa E retorna email (a UI mostra pra desambiguar). A futura busca
 * PÚBLICA de Cozinheiros (#279) chamará o MESMO `searchUsers` com `includeEmail=false` + uma
 * projeção pública própria. Resposta = SÓ as chaves de `AdminUserResult` (allowlist da projeção
 * PURA — nunca a linha crua, sem deletedAt/banReason/etc.). q vazio/curto → `{ results: [] }`
 * (sem erro, sem ida ao banco — o `classifyUserQuery` devolve null).
 */
export async function GET(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const q = new URL(req.url).searchParams.get('q') ?? ''
  const rows = await searchUsers(getDb(), { q, includeEmail: true })
  return Response.json({ results: rows.map(projectAdminUserResult) })
}
