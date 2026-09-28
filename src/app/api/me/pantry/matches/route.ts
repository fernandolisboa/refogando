import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { parseRequestLocale } from '@/server/http/params'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { loadPantryMatches } from '@/server/pantry/pantry'

/**
 * "O que dá pra fazer com o que eu tenho" (ADR-0038 dec.2–4): as Receitas que o usuário pode salvar com no
 * máximo 3 Itens faltando frente à SUA Despensa, ordenadas pelo que falta.
 *
 * GET ?basics=0|1[&locale] → `{ matches: PantryMatch[] }`. `basics` ("Tenho o básico": sal, água, óleo,
 * azeite, pimenta-do-reino) é ligado por padrão — só `basics=0` desliga.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  const url = new URL(request.url)
  const basics = url.searchParams.get('basics') !== '0'
  const requestLocale = parseRequestLocale(request)
  const loc = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const matches = await loadPantryMatches({
    db: getDb(),
    userId: g.session.user.id,
    basics,
    requestLocale: loc,
    fallbackName: MESSAGES[loc].minhasCriacoes.semTitulo,
  })
  return Response.json({ matches }, { headers: { 'cache-control': 'no-store' } })
}
