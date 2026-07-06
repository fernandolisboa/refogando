import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { isUuid, parseRequestLocale } from '@/server/http/params'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import {
  applyAddAdhocItemToShoppingList,
  applyAddRecipeToShoppingList,
  loadShoppingListItems,
} from '@/server/shopping-list/shopping-list'

/**
 * Itens de UMA Lista de compras (issue #526, ADR-0032 dec.2/4 + issue #528, dec.5). Route FINO,
 * espelha `me/collections/[collectionId]/items`: uuid inválido → 404 (leak-safe); `requireSession`
 * ANTES do DB; ownership da Lista + elegibilidade da Receita resolvidos no core (ambos ⇒ o MESMO
 * `not_found`, nunca revela qual dos dois falhou).
 *
 * GET → `{ list: {id,name}, items: ShoppingListItemView[] }` (já consolidados) | 404 not_found.
 *
 * POST tem DOIS formatos de corpo, discriminados pela presença de `nome` (item AVULSO, #528)
 * versus `recipeId` (de-Receita, #526) — o mesmo verbo "adicionar item a esta Lista", duas fontes:
 *   - `{ nome, quantidade?, unidade? }` → item avulso (nome obrigatório; qtd/unidade opcionais,
 *     mesmo enum). 200 (merge por nome idempotente) | 400 nome_invalido/quantidade_invalida/
 *     unidade_invalida | 404 not_found (lista de outro).
 *   - `{ recipeId }` → 200 (merge idempotente) | 404 not_found (lista de outro / uuid / Receita não
 *     elegível). `?locale` escolhe o idioma do NOME gravado no snapshot (mesma tese de `me/recipes`).
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
    nome?: unknown
    quantidade?: unknown
    unidade?: unknown
  }

  // Item AVULSO (#528): discriminado pela presença de `nome`. Nome obrigatório (string, senão
  // 400); quantidade/unidade OPCIONAIS (undefined/null ⇒ ausente; senão precisam ser string — a
  // validação de FORMATO/enum mora no core, que devolve o kind específico).
  if (body.nome !== undefined) {
    if (typeof body.nome !== 'string') {
      return Response.json({ error: 'nome_invalido' }, { status: 400 })
    }
    if (body.quantidade !== undefined && body.quantidade !== null && typeof body.quantidade !== 'string') {
      return Response.json({ error: 'quantidade_invalida' }, { status: 400 })
    }
    if (body.unidade !== undefined && body.unidade !== null && typeof body.unidade !== 'string') {
      return Response.json({ error: 'unidade_invalida' }, { status: 400 })
    }

    const res = await applyAddAdhocItemToShoppingList({
      db: getDb(),
      userId: g.session.user.id,
      listId,
      nome: body.nome,
      quantidade: (body.quantidade as string | null | undefined) ?? null,
      unidade: (body.unidade as string | null | undefined) ?? null,
    })

    switch (res.kind) {
      case 'ok':
        return Response.json({ ok: true }, { status: 200 })
      case 'invalid_nome':
        return Response.json({ error: 'nome_invalido' }, { status: 400 })
      case 'invalid_quantidade':
        return Response.json({ error: 'quantidade_invalida' }, { status: 400 })
      case 'invalid_unidade':
        return Response.json({ error: 'unidade_invalida' }, { status: 400 })
      case 'not_found':
        return Response.json({ error: 'not_found' }, { status: 404 })
    }
  }

  // De-Receita (#526, comportamento pré-existente): `recipeId` obrigatório e uuid.
  if (typeof body.recipeId !== 'string' || !isUuid(body.recipeId)) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const requestLocale = parseRequestLocale(request)
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const res = await applyAddRecipeToShoppingList({
    db: getDb(),
    userId: g.session.user.id,
    listId,
    recipeId: body.recipeId,
    locale,
  })

  switch (res.kind) {
    case 'ok':
      return Response.json({ ok: true }, { status: 200 })
    case 'not_found':
      return Response.json({ error: 'not_found' }, { status: 404 })
  }
}
