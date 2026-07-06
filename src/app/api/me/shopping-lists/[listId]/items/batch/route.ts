import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { applyAddRecipesToShoppingList } from '@/server/shopping-list/shopping-list'
import { MAX_RECIPES_PER_BATCH_ADD } from '@/domain/shopping-list-item'

/**
 * Multi-adicionar N Receitas a UMA Lista de compras numa ação (issue #530, ADR-0032 dec.7 — fatia
 * E). Route FINO, irmã de `items/route.ts` (fatia A2): mesmo `runtime`, mesmo `requireSession`
 * ANTES do DB, mesmo 404 leak-safe pra uuid inválido/Lista de outro usuário. A diferença é o body
 * — `recipeIds: string[]` em vez de `recipeId: string` — e a resposta, que devolve CONTAGENS
 * (`addedCount`/`skippedCount`) em vez de um booleano só, porque uma Receita individual do lote
 * pode ser pulada (não existe / não elegível) sem derrubar as demais.
 *
 * POST {recipeIds} → 200 `{ ok:true, addedCount, skippedCount }` | 404 not_found (Lista de outro
 * usuário, uuid malformado, ou NENHUM id do body é um uuid válido) | 422 lote_grande_demais (acima
 * de `MAX_RECIPES_PER_BATCH_ADD`). `?locale` escolhe o idioma do NOME gravado no snapshot, como em
 * `items/route.ts`.
 *
 * Ids duplicados no body são DEDUPLICADOS aqui (re-adicionar a mesma Receita dentro do MESMO lote
 * seria só uma mescla redundante — dec.4 já trata isso como idempotente, mas deduplicar evita
 * round-trips inúteis e um `addedCount` inflado).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> {
  const { listId } = await params
  if (!isUuid(listId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as { recipeIds?: unknown }
  const raw = Array.isArray(body.recipeIds) ? body.recipeIds : []
  const recipeIds = Array.from(
    new Set(raw.filter((v): v is string => typeof v === 'string' && isUuid(v))),
  )
  if (recipeIds.length === 0) return Response.json({ error: 'not_found' }, { status: 404 })
  if (recipeIds.length > MAX_RECIPES_PER_BATCH_ADD) {
    return Response.json({ error: 'lote_grande_demais' }, { status: 422 })
  }

  const requestLocale = parseRequestLocale(request)
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const res = await applyAddRecipesToShoppingList({
    db: getDb(),
    userId: g.session.user.id,
    listId,
    recipeIds,
    locale,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(
        { ok: true, addedCount: res.addedCount, skippedCount: res.skippedCount },
        { status: 200 },
      )
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
