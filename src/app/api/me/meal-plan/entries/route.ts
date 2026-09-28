import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, readJsonObject } from '@/server/http/params'
import { isMealSlot, isPlanDate, parsePlanNote, parsePlanPorcoes } from '@/domain/meal-plan'
import { applyAddMealPlanEntry, applyAddMealPlanNote, type MealPlanAddResult } from '@/server/meal-plan/meal-plan'

/**
 * Planejar UMA Receita — ou anotar um texto livre (ADR-0037) — num dia/refeição (ADR-0035 dec.1/4).
 *
 * POST {recipeId, day, slot, porcoes?} → 200 `{ ok: true, entryId }` (re-planejar a mesma Receita
 * no mesmo dia+refeição atualiza as porções — idempotente) | 400 dados_invalidos (dia/refeição/
 * porções malformados) | 404 not_found (Receita inexistente ou inelegível — leak-safe, mesmo gate de
 * Salvar) | 422 dia_cheio (teto de refeições no dia).
 *
 * POST {note, day, slot} → Anotação (ADR-0037): 200 `{ ok: true, entryId }` (a mesma anotação na mesma
 * refeição devolve a entrada existente) | 400 dados_invalidos (anotação vazia/longa, ou junto de
 * `recipeId`/`porcoes` — Anotação não tem Receita nem porções) | 422 dia_cheio.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await readJsonObject(request)) as {
    recipeId?: unknown
    note?: unknown
    day?: unknown
    slot?: unknown
    porcoes?: unknown
  }

  if (body.note !== undefined) {
    const note = parsePlanNote(body.note)
    if (
      note === 'invalid' ||
      body.recipeId !== undefined ||
      body.porcoes != null ||
      !isPlanDate(body.day) ||
      !isMealSlot(body.slot)
    ) {
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
    }
    return toResponse(
      await applyAddMealPlanNote({ db: getDb(), userId: g.session.user.id, day: body.day, slot: body.slot, note }),
    )
  }

  if (typeof body.recipeId !== 'string' || !isUuid(body.recipeId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  const porcoes = parsePlanPorcoes(body.porcoes)
  if (!isPlanDate(body.day) || !isMealSlot(body.slot) || porcoes === 'invalid') {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  return toResponse(
    await applyAddMealPlanEntry({
      db: getDb(),
      userId: g.session.user.id,
      recipeId: body.recipeId,
      day: body.day,
      slot: body.slot,
      porcoes,
    }),
  )
}

function toResponse(res: MealPlanAddResult): Response {
  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true, entryId: res.entryId }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'day_full':
      return Response.json({ error: 'dia_cheio' }, { status: 422 })
  }
}
