import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { parseRequestLocale } from '@/server/http/params'
import { parsePlanRange } from '@/domain/meal-plan'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { loadMealPlan } from '@/server/meal-plan/meal-plan'

/**
 * Plano de refeições do PRÓPRIO usuário (ADR-0035) — leitura de um intervalo de dias. Espelha
 * `me/shopping-lists`: `requireSession` ANTES do DB (Visitante ⇒ 401, zero efeito), resposta pessoal
 * `no-store`, escopo HARD-WIRED em `session.user.id`.
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&locale] → `{ entries: MealPlanEntryView[] }` | 400
 * intervalo_invalido. O CLIENTE escolhe a semana (o dia de hoje é o do fuso dele, dec.2); o intervalo
 * é inclusivo e limitado a `MEAL_PLAN_MAX_RANGE_DAYS`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const url = new URL(request.url)
  const range = parsePlanRange(url.searchParams.get('from'), url.searchParams.get('to'))
  if (!range) return Response.json({ error: 'intervalo_invalido' }, { status: 400 })

  const requestLocale = parseRequestLocale(request)
  const loc = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const entries = await loadMealPlan({
    db: getDb(),
    userId: g.session.user.id,
    range,
    requestLocale,
    fallbackName: MESSAGES[loc].minhasCriacoes.semTitulo,
  })
  return Response.json({ entries }, { headers: { 'cache-control': 'no-store' } })
}
