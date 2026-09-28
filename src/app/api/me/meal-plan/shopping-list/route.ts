import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, readJsonObject, parseRequestLocale } from '@/server/http/params'
import { MEAL_PLAN_LIST_MAX_RANGE_DAYS, parsePlanRange } from '@/domain/meal-plan'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { applyMealPlanToShoppingList } from '@/server/meal-plan/meal-plan'

/**
 * Plano → Lista de compras (ADR-0035 dec.5): joga na Lista escolhida os ingredientes de todas as
 * Refeições planejadas do intervalo, cada uma escalada pelas SUAS porções (mesmo merge/agregação do
 * ADR-0032). O destino é uma Lista existente (`listId`) OU uma nova (`newListName`), criada AQUI e só
 * quando o período tem refeições — nunca sobra lista órfã de um "gerar" que não gerou.
 *
 * POST {from, to, listId | newListName}[?locale] → 200 `{ ok: true, list: {id, name}, addedCount,
 * skippedCount, semPorcoesCount }` | 400 nome_invalido | 409 nome_duplicado | 422 limite_listas (lista
 * nova, mesmos códigos de `POST /api/me/shopping-lists`) | 400 intervalo_invalido (inclusive mais de
 * 7 dias, `MEAL_PLAN_LIST_MAX_RANGE_DAYS`) | 404 not_found (Lista de outro usuário, uuid malformado,
 * nenhum destino) | 422 plano_vazio (nenhuma refeição no intervalo). `?locale` escolhe o idioma do NOME gravado no
 * snapshot, como em `shopping-lists/[listId]/items`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await readJsonObject(request)) as {
    from?: unknown
    to?: unknown
    listId?: unknown
    newListName?: unknown
  }
  let target: { listId: string } | { newListName: string }
  if (typeof body.newListName === 'string' && body.listId === undefined) {
    target = { newListName: body.newListName }
  } else if (typeof body.listId === 'string' && isUuid(body.listId)) {
    target = { listId: body.listId }
  } else {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  const range = parsePlanRange(body.from, body.to, MEAL_PLAN_LIST_MAX_RANGE_DAYS)
  if (!range) return Response.json({ error: 'intervalo_invalido' }, { status: 400 })

  const requestLocale = parseRequestLocale(request)
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const res = await applyMealPlanToShoppingList({
    db: getDb(),
    userId: g.session.user.id,
    target,
    range,
    locale,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(
        {
          ok: true,
          list: res.list,
          addedCount: res.addedCount,
          skippedCount: res.skippedCount,
          semPorcoesCount: res.semPorcoesCount,
        },
        { status: 200 },
      )
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'empty':
      return Response.json({ error: 'plano_vazio' }, { status: 422 })
    case 'invalid_name':
      return Response.json({ error: 'nome_invalido' }, { status: 400 })
    case 'duplicate_name':
      return Response.json({ error: 'nome_duplicado' }, { status: 409 })
    case 'limit_reached':
      return Response.json({ error: 'limite_listas' }, { status: 422 })
  }
}
