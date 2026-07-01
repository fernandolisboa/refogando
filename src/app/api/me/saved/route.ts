import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { parseRequestLocale } from '@/server/http/params'
import { loadSavedRecipes } from '@/server/recipe/collections'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * "Todos" os Salvos (#364) — TODAS as Receitas que o caller salvou (#362), mais recentes primeiro,
 * gateadas por visibilidade (C1: uma pública de 3º que virou privada/removida some, o save persiste).
 * Route FINO espelhando `me/recipes`: `requireSession` ANTES do DB (Visitante ⇒ 401); LEAK-SAFE por
 * `session.user.id`. `?locale` escolhe o idioma do título; `fallbackName` vem localizado.
 *
 * GET → `{ recipes: RecipeListItem[] }`, `cache-control: no-store` (resposta pessoal).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const requestLocale = parseRequestLocale(request)
  const loc = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE
  const fallbackName = MESSAGES[loc].minhasCriacoes.semTitulo

  const recipes = await loadSavedRecipes({
    db: getDb(),
    userId: g.session.user.id,
    requestLocale,
    fallbackName,
  })
  return Response.json({ recipes }, { headers: { 'cache-control': 'no-store' } })
}
