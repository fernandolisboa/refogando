import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'
import { isUuid } from '@/server/http/params'
import {
  searchCatalogApprovedRecipes,
  loadCatalogApprovedRecipeTitle,
} from '@/server/recipe/recipe-of-week'

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/**
 * Lookup do CATÁLOGO APROVADO por título — `GET /api/admin/catalog/highlight-search` (#457).
 * ADMIN-only (`requireRole(req,'admin')`, fail-closed — espelha `/api/admin/config`, que é quem
 * de fato persiste a escolha). Alimenta o picker "Receita da semana" em `/admin/catalog`:
 *
 *  - `?q=<termo>` — busca por título (ILIKE) restrita a `origin=catalog AND curation_status=
 *    'approved'`; devolve até `RECIPE_OF_WEEK_SEARCH_LIMIT` hits `{ recipeId, titulo, slug }`.
 *  - `?id=<uuid>` — lookup EXATO por id (usado pra exibir "Escolhida: <título>" da config já
 *    persistida, que guarda só o `recipeId`); devolve `{ hit: null }` se o id não é (mais)
 *    catálogo aprovado OU não tem forma de uuid (curto-circuita ANTES do DB — um id malformado
 *    cairia numa coluna `uuid` e lançaria 22P02/500; espelha o guard de `server/http/params`).
 *  - nenhum dos dois ⇒ 400 `parametro_invalido` (não lista o catálogo inteiro por engano).
 *
 * `locale` vem de `?locale=` (mesmo padrão de `/api/curate/recipes/[id]`) — título/slug no idioma
 * que o Curador está editando; ausente/inválido ⇒ `DEFAULT_LOCALE`.
 */
export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'admin')
  if (!g.ok) return g.response

  const url = new URL(request.url)
  const localeParam = url.searchParams.get('locale')
  const locale = (localeParam && canonicalLocale(localeParam)) || DEFAULT_LOCALE
  const db = getDb()

  const id = url.searchParams.get('id')
  if (id !== null) {
    const hit = isUuid(id) ? await loadCatalogApprovedRecipeTitle(db, id, locale) : null
    return Response.json({ hit }, { headers: { 'cache-control': 'no-store' } })
  }

  const q = url.searchParams.get('q')
  if (q !== null) {
    const hits = await searchCatalogApprovedRecipes(db, { q, requestLocale: locale })
    return Response.json({ hits }, { headers: { 'cache-control': 'no-store' } })
  }

  return Response.json({ error: 'parametro_invalido' }, { status: 400 })
}
