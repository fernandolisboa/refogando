import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { applyCollectionAddItem, loadCollectionItems } from '@/server/recipe/collections'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Itens de UMA Coleção (#364). Route FINO: uuid inválido → 404; `requireSession` ANTES do DB;
 * ownership no core (coleção de outro ⇒ 404). O `?locale` escolhe o idioma do título exibido
 * (mesma tese de `me/recipes`); o `fallbackName` ("sem título") vem localizado.
 *
 * GET → `{ recipes: RecipeListItem[] }` (gateado por visibilidade, C1) | 404 not_found.
 * POST {recipeId} → 200 | 404 not_found (coleção/uuid) | 422 nao_salva (Receita não salva).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
): Promise<Response> {
  const { collectionId } = await params
  if (!isUuid(collectionId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const requestLocale = parseRequestLocale(request)
  const loc = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE
  const fallbackName = MESSAGES[loc].minhasCriacoes.semTitulo

  const res = await loadCollectionItems({
    db: getDb(),
    userId: g.session.user.id,
    collectionId,
    requestLocale,
    fallbackName,
  })
  if (res.kind === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json({ recipes: res.recipes }, { headers: { 'cache-control': 'no-store' } })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
): Promise<Response> {
  const { collectionId } = await params
  if (!isUuid(collectionId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { recipeId?: unknown }
  if (typeof body.recipeId !== 'string' || !isUuid(body.recipeId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const res = await applyCollectionAddItem({
    db: getDb(),
    userId: g.session.user.id,
    collectionId,
    recipeId: body.recipeId,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
    case 'not_saved':
      return Response.json({ error: 'nao_salva' }, { status: 422 })
  }
}
