import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { shoppingList, shoppingListItem, recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import {
  DEFAULT_SHOPPING_LIST_NAME,
  MAX_SHOPPING_LISTS_PER_USER,
  validateShoppingListName,
} from '@/domain/shopping-list'
import { consolidateIngredientsToAdd, type IngredientToAdd } from '@/domain/shopping-list-item'
import { eligibleToSaveByViewer } from '@/domain/recipe-pool'
import { resolveIngredientNames, resolveIngredientName } from '@/domain/recipe-read'
import type { Unidade } from '@/domain/vocabulary'
import { pgCode } from '@/server/recipe/visibility'

/**
 * Núcleo com efeito da Lista de compras — CONTAINER (issue #525, ADR-0032 dec.1) + o TRACER de
 * adicionar-de-receita/agregação (issue #526, ADR-0032 dec.2/4) + o CHECK-OFF persistente (issue
 * #529, ADR-0032 dec.6). Espelha o estilo de `@/server/recipe/collections` (mesma disciplina de
 * discriminated unions + `db: Database` por parâmetro): cada Lista é uma pasta PRIVADA nomeada de
 * UM usuário, `UNIQUE(user_id, name)`.
 *
 * PRIVACIDADE (inegociável, ADR-0032 invariantes): NENHUMA leitura é anônima. Toda função escopa
 * por `shopping_list.user_id = userId`; "não é sua" e "não existe" colapsam no MESMO `not_found`
 * (404 leak-safe, como `collections.ts`). Sem toggle público no v1.
 */

// ── Tipos de retorno (discriminated unions mapeadas a HTTP pelas rotas) ──────────

export type ShoppingListSummary = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  itemCount: number
}

export type ShoppingListCreateResult =
  | { kind: 'ok'; list: { id: string; name: string; createdAt: string } }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'limit_reached' }

export type ShoppingListRenameResult =
  | { kind: 'ok' }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'not_found' }

export type ShoppingListDeleteResult = { kind: 'ok' } | { kind: 'not_found' }

// ── CRUD de Lista ────────────────────────────────────────────────────────────────

/**
 * Cria uma Lista de compras. Valida o nome (invalid_name); impõe o cap por usuário
 * (limit_reached); o INSERT com `onConflictDoNothing` no alvo (user_id, name) devolve vazio ⇒
 * duplicate_name (idempotente contra corrida — a UNIQUE é a rede final). Espelha
 * `applyCollectionCreate` byte-a-byte.
 */
export async function applyShoppingListCreate(input: {
  db: Database
  userId: string
  name: string
}): Promise<ShoppingListCreateResult> {
  const { db, userId, name } = input

  const v = validateShoppingListName(name)
  if (!v.ok) return { kind: 'invalid_name' }

  // Cap por usuário (anti-abuso barato): conta antes de inserir. Corrida no limite é aceitável
  // (o cap é folgado; não há invariante crítica), e a UNIQUE cobre a de nome.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(shoppingList)
    .where(eq(shoppingList.userId, userId))
  if (n >= MAX_SHOPPING_LISTS_PER_USER) return { kind: 'limit_reached' }

  const [row] = await db
    .insert(shoppingList)
    .values({ userId, name: v.name })
    .onConflictDoNothing({ target: [shoppingList.userId, shoppingList.name] })
    .returning({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
  if (!row) return { kind: 'duplicate_name' }

  return {
    kind: 'ok',
    list: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() },
  }
}

/**
 * Renomeia uma Lista do próprio usuário (inclusive a lista-padrão — nada a impede de ser
 * renomeada). Valida o nome antes; UPDATE escopado por (id, user_id) — vazio ⇒ not_found
 * (leak-safe: não é sua / não existe). Duplicado colide na UNIQUE (23505) ⇒ duplicate_name
 * (`onConflictDoNothing` não vale em UPDATE — daí o try/catch, espelha `applyCollectionRename`).
 */
export async function applyShoppingListRename(input: {
  db: Database
  userId: string
  listId: string
  name: string
}): Promise<ShoppingListRenameResult> {
  const { db, userId, listId, name } = input

  const v = validateShoppingListName(name)
  if (!v.ok) return { kind: 'invalid_name' }

  try {
    const [row] = await db
      .update(shoppingList)
      .set({ name: v.name, updatedAt: new Date() })
      .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
      .returning({ id: shoppingList.id })
    if (!row) return { kind: 'not_found' }
    return { kind: 'ok' }
  } catch (e) {
    if (pgCode(e) === '23505') return { kind: 'duplicate_name' }
    throw e
  }
}

/**
 * Apaga uma Lista do próprio usuário. DELETE escopado por (id, user_id) — vazio ⇒ not_found. A
 * FK ON DELETE cascade apaga os `shopping_list_item` (sem órfãos). Apagar a lista-padrão é
 * permitido — `ensureDefaultShoppingList` recria no próximo uso (idempotente).
 */
export async function applyShoppingListDelete(input: {
  db: Database
  userId: string
  listId: string
}): Promise<ShoppingListDeleteResult> {
  const { db, userId, listId } = input

  const [row] = await db
    .delete(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
    .returning({ id: shoppingList.id })
  if (!row) return { kind: 'not_found' }
  return { kind: 'ok' }
}

/**
 * Garante que o usuário tem a lista-PADRÃO ("Lista de compras", ADR-0032 dec.1) — cria no 1º uso,
 * IDEMPOTENTE (não duplica sob corrida): `onConflictDoNothing` no alvo (user_id, name); se vazio
 * (já existia), busca a existente. Chamada pelo 1º "adicionar" (fatia A2) e por qualquer fluxo que
 * precise de "a lista padrão do usuário" sem exigir que ele tenha criado uma antes.
 */
export async function ensureDefaultShoppingList(input: {
  db: Database
  userId: string
}): Promise<{ id: string; name: string; createdAt: string }> {
  const { db, userId } = input

  const [inserted] = await db
    .insert(shoppingList)
    .values({ userId, name: DEFAULT_SHOPPING_LIST_NAME })
    .onConflictDoNothing({ target: [shoppingList.userId, shoppingList.name] })
    .returning({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
  if (inserted) {
    return { id: inserted.id, name: inserted.name, createdAt: inserted.createdAt.toISOString() }
  }

  // Corrida perdida ou já existia: a linha JÁ está lá (a UNIQUE garante que existe exatamente 1).
  const [existing] = await db
    .select({ id: shoppingList.id, name: shoppingList.name, createdAt: shoppingList.createdAt })
    .from(shoppingList)
    .where(and(eq(shoppingList.userId, userId), eq(shoppingList.name, DEFAULT_SHOPPING_LIST_NAME)))
  if (!existing) {
    // Não deveria ocorrer (a UNIQUE só bloqueou o INSERT porque a linha existe); erro honesto.
    throw new Error('ensureDefaultShoppingList: linha esperada não encontrada após conflito')
  }
  return { id: existing.id, name: existing.name, createdAt: existing.createdAt.toISOString() }
}

// ── Leitores ─────────────────────────────────────────────────────────────────────

/**
 * Lista as Listas de compras do usuário com a contagem de itens. LEFT JOIN + COUNT(item.id) (a
 * lista vazia dá 1 linha all-NULL e `count(*)` daria 1 errado; `count(item.id)` conta NULLs como
 * 0 — espelha `loadCollections`). Ordena por nome. `itemCount` reflete as linhas JÁ CONSOLIDADAS
 * de `shopping_list_item` (A2) — a mesclagem faz o número de linhas nunca dobrar por re-adicionar.
 */
export async function loadShoppingLists(input: {
  db: Database
  userId: string
}): Promise<ShoppingListSummary[]> {
  const { db, userId } = input
  const rows = await db
    .select({
      id: shoppingList.id,
      name: shoppingList.name,
      createdAt: shoppingList.createdAt,
      updatedAt: shoppingList.updatedAt,
      itemCount: sql<number>`count(${shoppingListItem.id})::int`,
    })
    .from(shoppingList)
    .leftJoin(shoppingListItem, eq(shoppingListItem.listId, shoppingList.id))
    .where(eq(shoppingList.userId, userId))
    .groupBy(shoppingList.id)
    .orderBy(asc(shoppingList.name))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    itemCount: r.itemCount,
  }))
}

// ── Adicionar-de-receita + agregação (fatia A2, issue #526, ADR-0032 dec.2/4) ────

export type ShoppingListAddRecipeResult = { kind: 'ok' } | { kind: 'not_found' }

/**
 * Adiciona os ingredientes de UMA Receita a uma Lista — o TRACER da fatia A2 (ADR-0032 dec.2/4): o
 * valor central, demoável ponta-a-ponta. Quantidade BASE (sem escala por porções-alvo — dec.3/#452
 * é a fatia B).
 *
 * GATE DUPLO, ambos leak-safe no MESMO `not_found` (nunca revela QUAL dos dois falhou):
 *  1. a Lista é do PRÓPRIO usuário (`shopping_list.user_id = userId`);
 *  2. a Receita é ELEGÍVEL pro viewer — o MESMO gate de Salvar (`eligibleToSaveByViewer`, #362/
 *     ADR-0027 D2): pool público (comunidade pública + catálogo aprovado) OU a PRÓPRIA Receita
 *     mesmo privada ("montar a lista a partir do meu caderno particular").
 *
 * NOME por-locale: resolvido AGORA, no momento do add — MESMA resolução do display (#426,
 * `resolveIngredientNames`/`resolveIngredientName`) — reuso, não reimplementação. O SNAPSHOT grava
 * esse nome; editar/apagar a Receita depois NÃO muda a linha (dec.3: sem FK viva pro texto da
 * Receita, só `source_recipe_id` best-effort de proveniência).
 *
 * MERGE (dec.2/4): consolida os Itens da Receita em linhas por (chave, unidade) via
 * `consolidateIngredientsToAdd` (domínio puro) — nunca duas linhas do MESMO lote miram o MESMO
 * alvo de conflito no upsert (o Postgres rejeitaria). O upsert soma `quantidade` só quando os DOIS
 * lados têm valor (NULL preserva o lado presente, nunca apaga o que já se sabia — mesmo predicado
 * de `combineQuantidade`, agora em SQL pro caso em que a linha JÁ existia no banco);
 * `source_recipe_id` permanece a MESMA Receita ao RE-ADICIONAR (idempotência sem perder "da
 * Feijoada"), mas vira `NULL` assim que uma Receita DIFERENTE contribui pra mesma linha (mesclada
 * de várias fontes). `nome`/`ingredient_id` do PRIMEIRO insert NUNCA mudam por um merge — nem
 * entram no `set` do upsert (o UPDATE do Postgres preserva a coluna quando ela não é mencionada).
 */
export async function applyAddRecipeToShoppingList(input: {
  db: Database
  userId: string
  listId: string
  recipeId: string
  locale: string
}): Promise<ShoppingListAddRecipeResult> {
  const { db, userId, listId, recipeId, locale } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      origin: recipe.origin,
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
  if (!gate || !eligibleToSaveByViewer(gate, userId)) return { kind: 'not_found' }

  // Nomes de ingrediente por-locale (#426): MESMA resolução do display (`resolveRecipeView`, via
  // `resolveIngredientNames`/`resolveIngredientName`) — reuso, não reimplementação. Só o locale
  // pedido carrega `ingredientes` (o original nunca carrega — cai no rawText, ver recipe-read.ts).
  const [tr] = await db
    .select()
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
  const localizedNames = resolveIngredientNames({ requestLocale: locale, translations: tr ? [tr] : [] })

  const ingredientRows = await db
    .select({
      ordem: recipeIngredient.ordem,
      ingredientId: recipeIngredient.ingredientId,
      quantidade: recipeIngredient.quantidade,
      unidade: recipeIngredient.unidade,
      rawText: recipeIngredient.rawText,
    })
    .from(recipeIngredient)
    .where(eq(recipeIngredient.recipeId, recipeId))
    .orderBy(recipeIngredient.ordem, recipeIngredient.id)

  const items: IngredientToAdd[] = ingredientRows.map((r) => ({
    ingredientId: r.ingredientId,
    nome: resolveIngredientName(localizedNames.get(r.ordem), r.rawText) ?? '',
    quantidade: r.quantidade,
    unidade: r.unidade,
  }))

  const lines = consolidateIngredientsToAdd(items)
  if (lines.length === 0) return { kind: 'ok' } // Receita sem Itens nomeados: no-op válido, não é erro.

  await db
    .insert(shoppingListItem)
    .values(
      lines.map((l) => ({
        listId,
        nome: l.nome,
        quantidade: l.quantidade,
        unidade: l.unidade,
        ingredientId: l.ingredientId,
        sourceRecipeId: recipeId,
        matchKey: l.matchKey,
      })),
    )
    .onConflictDoUpdate({
      target: [shoppingListItem.listId, shoppingListItem.matchKey, shoppingListItem.unidade],
      set: {
        // NULL é "sem quantidade" (a_gosto/q.b.), não zero: só soma quando os DOIS lados têm
        // valor; um lado ausente preserva o PRESENTE (nunca apaga o que já se sabia) — mesmo
        // predicado de `combineQuantidade`, aqui em SQL pro caso em que a linha já existia.
        quantidade: sql`case
          when ${shoppingListItem.quantidade} is null or excluded.quantidade is null
            then coalesce(${shoppingListItem.quantidade}, excluded.quantidade)
          else ${shoppingListItem.quantidade} + excluded.quantidade
        end`,
        // Proveniência (dec.4): permanece a MESMA Receita ao RE-ADICIONAR (idempotência sem
        // perder "da Feijoada"); vira NULL assim que uma Receita DIFERENTE contribui pra mesma
        // linha (mesclada de várias fontes — a dica de UMA origem deixa de fazer sentido).
        sourceRecipeId: sql`case
          when ${shoppingListItem.sourceRecipeId} = excluded.source_recipe_id
            then ${shoppingListItem.sourceRecipeId}
          else null
        end`,
        updatedAt: sql`now()`,
      },
    })

  return { kind: 'ok' }
}

export type ShoppingListItemView = {
  id: string
  nome: string
  quantidade: string | null
  unidade: Unidade | null
  ingredientId: string | null
  sourceRecipeId: string | null
  checkedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ShoppingListItemsResult =
  | { kind: 'ok'; list: { id: string; name: string }; items: ShoppingListItemView[] }
  | { kind: 'not_found' }

/**
 * Vê UMA Lista de compras do próprio usuário com os Itens JÁ CONSOLIDADOS (dec.4: storage = linhas
 * agregadas, sem agregação-na-leitura). Ordena por criação (ordem de adição/merge). `checkedAt` é
 * passthrough — escrito por `applyToggleShoppingListItemChecked` (fatia D, dec.6); nasce `null` até
 * o dono marcar o Item como comprado.
 */
export async function loadShoppingListItems(input: {
  db: Database
  userId: string
  listId: string
}): Promise<ShoppingListItemsResult> {
  const { db, userId, listId } = input

  const [list] = await db
    .select({ id: shoppingList.id, name: shoppingList.name })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const rows = await db
    .select()
    .from(shoppingListItem)
    .where(eq(shoppingListItem.listId, listId))
    .orderBy(asc(shoppingListItem.createdAt), asc(shoppingListItem.id))

  return {
    kind: 'ok',
    list,
    items: rows.map((r) => ({
      id: r.id,
      nome: r.nome,
      quantidade: r.quantidade,
      unidade: r.unidade,
      ingredientId: r.ingredientId,
      sourceRecipeId: r.sourceRecipeId,
      checkedAt: r.checkedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  }
}

// ── Check-off PERSISTENTE (fatia D, issue #529, ADR-0032 dec.6) ──────────────────

export type ShoppingListItemToggleResult =
  | { kind: 'ok'; checkedAt: string | null }
  | { kind: 'not_found' }

/**
 * Marca/desmarca UM Item como comprado — PERSISTENTE (dec.6: "nada expira sozinho", o carimbo só
 * muda por ação explícita do dono). O cliente manda o estado-ALVO (`checked: boolean`), não um
 * toggle cego: idempotente sob duplo-clique/retry (marcar 2× não desmarca). Ownership em DUAS
 * pernas, ambas leak-safe no MESMO `not_found` (nunca revela qual falhou): 1) a Lista é do PRÓPRIO
 * usuário; 2) o Item pertence a ESSA Lista (o `where` do UPDATE escopa por `listId`, então um
 * `itemId` de OUTRA lista — inclusive de outro usuário — não casa e devolve not_found, sem
 * precisar de um SELECT extra).
 */
export async function applyToggleShoppingListItemChecked(input: {
  db: Database
  userId: string
  listId: string
  itemId: string
  checked: boolean
}): Promise<ShoppingListItemToggleResult> {
  const { db, userId, listId, itemId, checked } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const [row] = await db
    .update(shoppingListItem)
    .set({ checkedAt: checked ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(shoppingListItem.id, itemId), eq(shoppingListItem.listId, listId)))
    .returning({ checkedAt: shoppingListItem.checkedAt })
  if (!row) return { kind: 'not_found' }

  return { kind: 'ok', checkedAt: row.checkedAt?.toISOString() ?? null }
}

export type ShoppingListBulkRemoveResult = { kind: 'ok'; removed: number } | { kind: 'not_found' }

/**
 * "Remover marcados" (dec.6): apaga SÓ os Itens com `checked_at` NÃO-nulo da Lista do próprio
 * usuário. Ação EXPLÍCITA (nunca automática — nada expira sozinho); os itens desmarcados
 * permanecem intactos. Ownership por (id, user_id) antes do DELETE ⇒ not_found leak-safe.
 */
export async function applyRemoveCheckedShoppingListItems(input: {
  db: Database
  userId: string
  listId: string
}): Promise<ShoppingListBulkRemoveResult> {
  const { db, userId, listId } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const removed = await db
    .delete(shoppingListItem)
    .where(and(eq(shoppingListItem.listId, listId), isNotNull(shoppingListItem.checkedAt)))
    .returning({ id: shoppingListItem.id })

  return { kind: 'ok', removed: removed.length }
}

/**
 * "Limpar lista" (dec.6): apaga TODOS os Itens da Lista do próprio usuário — marcados e
 * desmarcados. A Lista em si SOBREVIVE (esvazia, não some — apagar a Lista é uma ação diferente,
 * `applyShoppingListDelete`). Ação EXPLÍCITA, nunca automática. Ownership por (id, user_id) antes
 * do DELETE ⇒ not_found leak-safe.
 */
export async function applyClearShoppingList(input: {
  db: Database
  userId: string
  listId: string
}): Promise<ShoppingListBulkRemoveResult> {
  const { db, userId, listId } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const removed = await db
    .delete(shoppingListItem)
    .where(eq(shoppingListItem.listId, listId))
    .returning({ id: shoppingListItem.id })

  return { kind: 'ok', removed: removed.length }
}
