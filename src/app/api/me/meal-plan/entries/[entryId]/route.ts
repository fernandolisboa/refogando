import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, readJsonObject } from '@/server/http/params'
import { isMealSlot, isPlanDate, parsePlanPorcoes } from '@/domain/meal-plan'
import { applyRemoveMealPlanEntry, applyUpdateMealPlanEntry } from '@/server/meal-plan/meal-plan'

/**
 * UMA Refeição planejada do próprio usuário (ADR-0035). uuid malformado ⇒ o MESMO 404 de "não é sua".
 *
 * PATCH {day?, slot?, porcoes?} → 200 `{ ok: true }` (campos ausentes ficam; `porcoes: null` volta às
 * porções da Receita) | 400 dados_invalidos (campo presente e malformado, ou corpo sem nenhum campo)
 * | 404 not_found | 409 ja_planejada (a mesma Receita, ou a mesma Anotação, já está no destino) |
 * 422 dia_cheio. `porcoes` numa Anotação (ADR-0037) ⇒ 400 dados_invalidos.
 * DELETE → 200 `{ ok: true }` | 404 not_found.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

type Ctx = { params: Promise<{ entryId: string }> }

export async function PATCH(request: Request, { params }: Ctx): Promise<Response> {
  const { entryId } = await params
  if (!isUuid(entryId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await readJsonObject(request)) as {
    day?: unknown
    slot?: unknown
    porcoes?: unknown
  }
  const hasDay = body.day !== undefined
  const hasSlot = body.slot !== undefined
  const hasPorcoes = 'porcoes' in body
  const porcoes = parsePlanPorcoes(body.porcoes)
  if (
    (!hasDay && !hasSlot && !hasPorcoes) ||
    (hasDay && !isPlanDate(body.day)) ||
    (hasSlot && !isMealSlot(body.slot)) ||
    porcoes === 'invalid'
  ) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  const res = await applyUpdateMealPlanEntry({
    db: getDb(),
    userId: g.session.user.id,
    entryId,
    ...(hasDay ? { day: body.day as string } : {}),
    ...(hasSlot && isMealSlot(body.slot) ? { slot: body.slot } : {}),
    ...(hasPorcoes ? { porcoes } : {}),
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'duplicate':
      return Response.json({ error: 'ja_planejada' }, { status: 409 })
    case 'day_full':
      return Response.json({ error: 'dia_cheio' }, { status: 422 })
    case 'invalid':
      return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
}

export async function DELETE(request: Request, { params }: Ctx): Promise<Response> {
  const { entryId } = await params
  if (!isUuid(entryId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyRemoveMealPlanEntry({ db: getDb(), userId: g.session.user.id, entryId })
  return res.kind === 'ok'
    ? Response.json({ ok: true }, { status: 200 })
    : Response.json({ error: 'not_found' }, { status: 404 })
}
