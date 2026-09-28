import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { readJsonObject } from '@/server/http/params'
import { parseMenuApplyRequest } from '@/domain/menu-suggestion'
import { applyMenuSuggestionEntries } from '@/server/meal-plan/menu-suggestion'

/**
 * Aceitar uma Sugestão de cardápio (ADR-0036): grava as entradas marcadas na prévia como Refeições
 * planejadas. O servidor NÃO confia na prévia (ela voltou pelo cliente): cada entrada passa de novo
 * pelo gate de Salvar, pelo teto por dia e pela UNIQUE; o que não passa é pulado e contado.
 *
 * POST {entries: [{recipeId, day, slot, porcoes?}]} (1..28, uma semana ISO) → 200 `{ addedCount,
 * skippedCount }` | 400 dados_invalidos.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const entries = parseMenuApplyRequest(await readJsonObject(request))
  if (!entries) return Response.json({ error: 'dados_invalidos' }, { status: 400 })

  const res = await applyMenuSuggestionEntries({ db: getDb(), userId: g.session.user.id, entries })
  return Response.json(res, { status: 200 })
}
