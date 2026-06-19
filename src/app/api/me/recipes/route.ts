import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { parseRequestLocale } from '@/server/http/params'
import { listMyRecipes } from '@/server/recipe/list-mine'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * GET /api/me/recipes — "Minhas criações" (issue #61). Lista TODAS as Receitas do PRÓPRIO
 * caller (private/playful/removida-do-pool incluídas), mais novas primeiro.
 *
 * FAIL-CLOSED: `requireSession` ANTES de tocar o DB ⇒ Visitante = 401 (nao_autenticado/
 * conta_desativada). LEAK-SAFE por construção: `listMyRecipes` escopa a query por `owner_id =
 * session.user.id` — só as criações do caller saem; nunca as de outro nem o catálogo
 * (owner_id NULL não casa). SEM filtro de pool/moderação aqui (o dono vê o que é seu).
 *
 * `?locale` escolhe o idioma do TÍTULO exibido (resolveName); o `fallbackName` (rótulo de
 * "sem título") vem localizado de MESSAGES (locale não-suportado cai no DEFAULT_LOCALE,
 * política "nunca tela quebrada"). Devolve `{ recipes: RecipeListItem[] }`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  // Sessão ANTES do DB: Visitante ⇒ 401, zero efeito colateral.
  const g = await requireSession(request)
  if (!g.ok) return g.response
  const ownerId = g.session.user.id

  const requestLocale = parseRequestLocale(request)
  const loc = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE
  const fallbackName = MESSAGES[loc].minhasCriacoes.semTitulo

  const recipes = await listMyRecipes(getDb(), { ownerId, requestLocale, fallbackName })

  return Response.json({ recipes })
}
