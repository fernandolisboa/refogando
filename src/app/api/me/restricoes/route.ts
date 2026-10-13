import { eq } from 'drizzle-orm'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { normalizarRestricoes, parseListaRestricoes } from '@/domain/restricoes-perfil'

/**
 * Restrições alimentares SALVAS do logado (ADR-0041) — `users.restricoes`. Rota PRÓPRIA, fora de `/api/me`,
 * de propósito: aquele contrato é o do perfil (boa parte PÚBLICA — nome, bio, links), e esta lista é privada e
 * sensível (LGPD Art. 5 II/11). Uma rota estreita devolve só o necessário para pré-marcar os pedidos.
 *
 * Owner-only via `requireSession` (ADR-0011, como `/api/me/locale`): 401 = Visitante ou conta soft-deletada.
 * Sem id no caminho ⇒ sem IDOR. Toca SÓ `users`. ADR-0010: route handler, nunca Server Action.
 *
 * GET → `{ restricoes }` (forma canônica). PUT `{ restricoes: Restricao[] }` → valida com zod contra o
 * vocabulário (qualquer valor desconhecido recusa a lista inteira: 400 `restricoes_invalidas`), grava a
 * forma canônica (sem repetição, na ordem do vocabulário) e a devolve. Lista vazia limpa. NUNCA loga a lista.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const [row] = await getDb()
    .select({ restricoes: users.restricoes })
    .from(users)
    .where(eq(users.id, g.session.user.id))
  return Response.json(
    { restricoes: normalizarRestricoes(row?.restricoes) },
    // Por-titular e sensível: nunca cacheado por intermediários.
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function PUT(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { restricoes?: unknown } | null
  const parsed = parseListaRestricoes(body?.restricoes)
  if (!parsed.ok) return Response.json({ error: 'restricoes_invalidas' }, { status: 400 })

  const [row] = await getDb()
    .update(users)
    .set({ restricoes: parsed.restricoes, updatedAt: new Date() })
    .where(eq(users.id, g.session.user.id))
    .returning({ restricoes: users.restricoes })
  if (!row) return Response.json({ error: 'nao_encontrado' }, { status: 404 })
  return Response.json(
    { restricoes: normalizarRestricoes(row.restricoes) },
    { headers: { 'cache-control': 'no-store' } },
  )
}
