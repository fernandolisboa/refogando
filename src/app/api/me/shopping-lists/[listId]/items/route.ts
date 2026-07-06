import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import {
  applyAddRecipeToShoppingList,
  applyClearShoppingList,
  loadShoppingListItems,
} from '@/server/shopping-list/shopping-list'

/**
 * Itens de UMA Lista de compras (issue #526, ADR-0032 dec.2/4) — o TRACER — + a escala por
 * porções-alvo da fatia B (#527, dec.3) + "limpar lista" (issue #529, dec.6). Route FINO, espelha
 * `me/collections/[collectionId]/items`: uuid inválido → 404 (leak-safe); `requireSession` ANTES
 * do DB; ownership da Lista + elegibilidade da Receita resolvidos no core (ambos ⇒ o MESMO
 * `not_found`, nunca revela qual dos dois falhou).
 *
 * GET → `{ list: {id,name}, items: ShoppingListItemView[] }` (já consolidados) | 404 not_found.
 * POST {recipeId, porcoesAlvo?} → 200 `{ ok: true, warning?: 'sem_porcoes' }` (merge idempotente;
 * `warning` presente quando `porcoesAlvo` foi pedido mas a Receita não declara `porcoes` — entrou
 * na BASE) | 404 not_found (lista de outro / uuid / Receita não elegível). `porcoesAlvo` inválido
 * (não-número, ≤ 0, não-finito) é IGNORADO silenciosamente — cai no fluxo BASE, mesma disciplina
 * defensiva de `scaleQuantidade` (#452). `?locale` escolhe o idioma do NOME gravado no snapshot
 * (mesma tese de `me/recipes`).
 * DELETE → "limpar lista" (dec.6): apaga TODOS os itens (marcados e não); a Lista sobrevive vazia.
 * Ação EXPLÍCITA — nada expira sozinho. "Remover marcados" (só os `checked_at` não-nulo) é o
 * segmento IRMÃO `items/checked` (literal casa antes do dinâmico `[itemId]`).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> {
  const { listId } = await params
  if (!isUuid(listId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await loadShoppingListItems({ db: getDb(), userId: g.session.user.id, listId })
  if (res.kind === 'not_found') return Response.json({ error: 'not_found' }, { status: 404 })

  return Response.json(
    { list: res.list, items: res.items },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> {
  const { listId } = await params
  if (!isUuid(listId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const body = (await request.json().catch(() => ({}))) as {
    recipeId?: unknown
    porcoesAlvo?: unknown
  }
  if (typeof body.recipeId !== 'string' || !isUuid(body.recipeId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  // Porções-alvo (#527): só número finito POSITIVO conta como pedido de escala; qualquer outra
  // coisa (string, negativo, zero, NaN/Infinity, ausente) é IGNORADA — cai no fluxo BASE, sem erro.
  const porcoesAlvo =
    typeof body.porcoesAlvo === 'number' && Number.isFinite(body.porcoesAlvo) && body.porcoesAlvo > 0
      ? body.porcoesAlvo
      : null

  const requestLocale = parseRequestLocale(request)
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const res = await applyAddRecipeToShoppingList({
    db: getDb(),
    userId: g.session.user.id,
    listId,
    recipeId: body.recipeId,
    locale,
    porcoesAlvo,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json(
        { ok: true, ...(res.warning ? { warning: res.warning } : {}) },
        { status: 200 },
      )
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> {
  const { listId } = await params
  if (!isUuid(listId)) return Response.json({ error: 'not_found' }, { status: 404 })

  const g = await requireSession(request)
  if (!g.ok) return g.response

  const res = await applyClearShoppingList({ db: getDb(), userId: g.session.user.id, listId })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true, removed: res.removed }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
