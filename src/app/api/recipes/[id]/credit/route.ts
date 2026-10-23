import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid } from '@/server/http/params'
import { setDerivedCreditVisible } from '@/server/recipe/derived-credit'

/**
 * Crédito na Receita derivada (#610, ADR-0052): o dono da BASE retira ("Retirar meu nome") ou devolve ("Mostrar meu
 * nome de novo") o "Baseada na receita … de @handle" de UMA derivada. `PUT { exibir: boolean }` → `{ exibir }`.
 *
 * Route fino: uuid inválido → 404; sessão ANTES do DB (anônimo → 401, zero efeito); corpo sem `exibir` booleano →
 * 400 `dados_invalidos`; o core autoriza pela linhagem (só o dono do pai, derivada pública) e devolve `not_found`
 * em qualquer outro caso (404 leak-safe, inclusive para o dono da própria derivada). ADR-0010: route handler.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => null)) as { exibir?: unknown } | null
  if (typeof body?.exibir !== 'boolean') return Response.json({ error: 'dados_invalidos' }, { status: 400 })

  const res = await setDerivedCreditVisible(getDb(), {
    recipeId: id,
    viewerId: g.session.user.id,
    exibir: body.exibir,
  })
  if (res.kind === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })
  return Response.json({ exibir: res.exibir }, { headers: { 'cache-control': 'no-store' } })
}
