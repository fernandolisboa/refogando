import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'

/**
 * Crédito nas cópias das minhas receitas (#610, ADR-0052) — Editar perfil.
 *
 * GET → `{ creditar }`: a preferência (`users.credit_on_derivatives`) de ver "Baseada na receita … de @handle" nas
 * cópias que outras pessoas publicam das receitas dela. PUT `{ creditar: boolean }` → `{ creditar }`; corpo inválido
 * → 400 `dados_invalidos`. Retirar o nome de UMA cópia é na página dela (`PUT /api/recipes/[id]/credit`). Rota
 * própria porque o `PATCH /api/me` exige o formulário inteiro (nome obrigatório) e esta é uma caixa que salva na hora.
 *
 * Owner-only via `requireSession` (401 = Visitante ou conta desativada); sem id no caminho ⇒ sem IDOR. Por-titular:
 * nunca cacheado. ADR-0010: route handler.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

const NO_STORE = { 'cache-control': 'no-store' }

export async function GET(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const [row] = await getDb()
    .select({ creditar: users.creditOnDerivatives })
    .from(users)
    .where(eq(users.id, g.session.user.id))
  if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  return Response.json({ creditar: row.creditar }, { headers: NO_STORE })
}

export async function PUT(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { creditar?: unknown } | null
  if (typeof body?.creditar !== 'boolean') return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  const [row] = await getDb()
    .update(users)
    .set({ creditOnDerivatives: body.creditar, updatedAt: new Date() })
    .where(eq(users.id, g.session.user.id))
    .returning({ creditar: users.creditOnDerivatives })
  if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  return Response.json({ creditar: row.creditar }, { headers: NO_STORE })
}
