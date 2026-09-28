import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, readJsonObject } from '@/server/http/params'
import { isMealSlot, isPlanDate, parsePlanPorcoes } from '@/domain/meal-plan'
import { applyAddMealPlanEntry } from '@/server/meal-plan/meal-plan'

/**
 * Planejar UMA Receita num dia/refeição (ADR-0035 dec.1/4).
 *
 * POST {recipeId, day, slot, porcoes?} → 200 `{ ok: true, entryId }` (re-planejar a mesma Receita
 * no mesmo dia+refeição atualiza as porções — idempotente) | 400 dados_invalidos (dia/refeição/
 * porções malformados) | 404 not_found (Receita inexistente ou inelegível — leak-safe, mesmo gate de
 * Salvar) | 422 dia_cheio (teto de refeições no dia).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await readJsonObject(request)) as {
    recipeId?: unknown
    day?: unknown
    slot?: unknown
    porcoes?: unknown
  }
  if (typeof body.recipeId !== 'string' || !isUuid(body.recipeId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  const porcoes = parsePlanPorcoes(body.porcoes)
  if (!isPlanDate(body.day) || !isMealSlot(body.slot) || porcoes === 'invalid') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  const res = await applyAddMealPlanEntry({
    db: getDb(),
    userId: g.session.user.id,
    recipeId: body.recipeId,
    day: body.day,
    slot: body.slot,
    porcoes,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true, entryId: res.entryId }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'day_full':
      return Response.json({ error: 'dia_cheio' }, { status: 422 })
  }
}
