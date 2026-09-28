import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { readJsonObject } from '@/server/http/params'
import {
  MEAL_PLAN_MAX_DATE,
  MEAL_PLAN_MIN_DATE,
  addDays,
  isPlanDate,
  weekStartOf,
} from '@/domain/meal-plan'
import { applyCopyPreviousWeek } from '@/server/meal-plan/meal-plan'

/**
 * "Copiar semana anterior" (ADR-0037): repete na semana `week` as Refeições planejadas (Receitas com as
 * porções gravadas e Anotações) da semana de antes, preenchendo SÓ as refeições do dia vazias. Escopo
 * HARD-WIRED em `session.user.id` (origem e destino são do próprio usuário).
 *
 * POST {week, fromDay?} → 200 `{ ok: true, addedCount, skippedCount }` | 400 dados_invalidos (`week` não
 * é uma segunda-feira dentro da janela do plano, ou `fromDay` fora dessa semana) | 422
 * semana_anterior_vazia (nada na semana anterior que caia no período pedido). `fromDay` é o "hoje" do
 * cliente na semana corrente (dec.2 do ADR-0035: o servidor nunca deriva o dia): dias que já passaram
 * não são preenchidos.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await readJsonObject(request)) as { week?: unknown; fromDay?: unknown }
  const { week, fromDay } = body
  if (
    !isPlanDate(week) ||
    weekStartOf(week) !== week ||
    addDays(week, -7) < MEAL_PLAN_MIN_DATE ||
    addDays(week, 6) > MEAL_PLAN_MAX_DATE
  ) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }
  if (fromDay !== undefined && (!isPlanDate(fromDay) || fromDay < week || fromDay > addDays(week, 6))) {
    return Response.json({ error: 'dados_invalidos' }, { status: 400 })
  }

  const res = await applyCopyPreviousWeek({
    db: getDb(),
    userId: g.session.user.id,
    week,
    ...(fromDay !== undefined ? { fromDay } : {}),
  })
  switch (res.kind) {
    case 'ok':
      return Response.json(
        { ok: true, addedCount: res.addedCount, skippedCount: res.skippedCount },
        { status: 200 },
      )
    case 'empty_source':
      return Response.json({ error: 'semana_anterior_vazia' }, { status: 422 })
  }
}
