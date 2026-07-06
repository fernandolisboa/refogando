import { and, asc, eq, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { shoppingList, shoppingListItem, recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import {
  DEFAULT_SHOPPING_LIST_NAME,
  MAX_SHOPPING_LISTS_PER_USER,
  validateShoppingListName,
} from '@/domain/shopping-list'
import {
  consolidateIngredientsToAdd,
  computeMatchKey,
  validateAdhocItem,
  isValidItemQuantidade,
  resolveShoppingListScale,
  scaleIngredientsToAdd,
  type IngredientToAdd,
  type ShoppingListLineDraft,
} from '@/domain/shopping-list-item'
import { eligibleToSaveByViewer } from '@/domain/recipe-pool'
import { resolveIngredientNames, resolveIngredientName } from '@/domain/recipe-read'
import type { Unidade } from '@/domain/vocabulary'
import { pgCode } from '@/server/recipe/visibility'

/**
 * Núcleo com efeito da Lista de compras — CONTAINER (issue #525, ADR-0032 dec.1) + o TRACER de
 * adicionar-de-receita/agregação (issue #526, ADR-0032 dec.2/4) + a ESCALA por porções (#527, B) +
 * o batch multi-receita (E) + o CHECK-OFF persistente (issue #529, ADR-0032 dec.6) + a EDIÇÃO À MÃO
 * (issue #528, ADR-0032 dec.5: item avulso, editar quantidade, remover linha). Espelha o estilo de
 * `@/server/recipe/collections` (mesma disciplina de discriminated unions + `db: Database` por
 * parâmetro): cada Lista é uma pasta PRIVADA nomeada de UM usuário, `UNIQUE(user_id, name)`.
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

export type ShoppingListAddRecipeResult =
  | { kind: 'ok'; warning?: 'sem_porcoes' }
  | { kind: 'not_found' }

/**
 * Núcleo SEM gate de Lista — adiciona os ingredientes de UMA Receita já sabida pertencer a uma
 * Lista existente (o caller resolve ownership da Lista ANTES de chamar isto). Compartilhado por
 * `applyAddRecipeToShoppingList` (fatia A2, uma Receita) e `applyAddRecipesToShoppingList` (fatia
 * E, issue #530/ADR-0032 dec.7, N Receitas) — o multi-adicionar chama isto UMA VEZ por Receita
 * selecionada, sequencialmente, então cada Receita ganha seu PRÓPRIO statement de upsert (evita o
 * "ON CONFLICT DO UPDATE command cannot affect row a second time" que um INSERT multi-Receita
 * bateria se duas Receitas diferentes citassem o mesmo ingrediente+unidade no MESMO statement) e
 * ainda assim MESCLA corretamente entre Receitas (o upsert de cada uma lê o estado deixado pela
 * anterior).
 *
 * ESCALA por PORÇÕES-ALVO (fatia B, issue #527, ADR-0032 dec.3): quando `porcoesAlvo` é passado E a
 * Receita declara `porcoes`, os Itens entram ESCALADOS — `ratio = porcoesAlvo ÷ receita.porcoes`,
 * `quantidade escalada = quantidade × ratio` (aritmética pura via `resolveShoppingListScale`/
 * `scaleIngredientsToAdd`, que reusam o escalador do #452 `scaleQuantidade` — NUNCA IA, NUNCA
 * reimplementado). A escala acontece ANTES de `consolidateIngredientsToAdd`, então a quantidade JÁ
 * ESCALADA é o que soma/faz upsert (dec.3: "o snapshot guarda a quantidade escalada"). Receita SEM
 * `porcoes` ⇒ entra na BASE (fator 1, não inventa porção) + `warning: 'sem_porcoes'` no retorno. O
 * fluxo de UMA Receita (fatia B) passa `porcoesAlvo`; o multi-adicionar (fatia E, dec.7) chama SEM
 * ele — as N Receitas entram na BASE (dec.7 é explícita: escalar fica só no fluxo de UMA Receita,
 * pra evitar um seletor de porções por item numa grade de seleção).
 *
 * GATE de elegibilidade da Receita — o MESMO gate de Salvar (`eligibleToSaveByViewer`, #362/
 * ADR-0027 D2): pool público (comunidade pública + catálogo aprovado) OU a PRÓPRIA Receita mesmo
 * privada ("montar a lista a partir do meu caderno particular"). Devolve `{ status: 'ineligible' }`
 * quando a Receita não existe ou o viewer não pode adicioná-la — o CALLER decide como isso vira
 * HTTP (404 leak-safe pro caso de uma Receita só, ou "pulada" silenciosamente pro lote).
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
type AddRecipeItemsOutcome =
  | { status: 'ineligible' }
  | { status: 'ok'; warning: 'sem_porcoes' | null }

async function addRecipeItemsToList(input: {
  db: Database
  userId: string
  listId: string
  recipeId: string
  locale: string
  /** Porções-alvo (fatia B, #527) — `null`/ausente ⇒ BASE (sem escala), o design do multi-add. */
  porcoesAlvo?: number | null
}): Promise<AddRecipeItemsOutcome> {
  const { db, userId, listId, recipeId, locale, porcoesAlvo = null } = input

  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      origin: recipe.origin,
      curationStatus: recipe.curationStatus,
      porcoes: recipe.porcoes,
    })
    .from(recipe)
    .where(eq(recipe.id, recipeId))
  if (!gate || !eligibleToSaveByViewer(gate, userId)) return { status: 'ineligible' }

  const scale = resolveShoppingListScale({ porcoesAlvo, receitaPorcoes: gate.porcoes })

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

  // Escala ANTES da consolidação (dec.3): a quantidade JÁ ESCALADA é o que agrega/faz upsert.
  const items: IngredientToAdd[] = scaleIngredientsToAdd(
    ingredientRows.map((r) => ({
      ingredientId: r.ingredientId,
      nome: resolveIngredientName(localizedNames.get(r.ordem), r.rawText) ?? '',
      quantidade: r.quantidade,
      unidade: r.unidade,
    })),
    scale.factor,
  )

  const lines = consolidateIngredientsToAdd(items)
  // Receita sem Itens nomeados: no-op válido, não é erro — mas o aviso de porções ainda vale (o
  // usuário pediu escala e a Receita não declara `porcoes`, mesmo que não haja o que adicionar).
  if (lines.length === 0) return { status: 'ok', warning: scale.warning }

  await upsertShoppingListLines({ db, listId, lines, sourceRecipeId: recipeId })

  return { status: 'ok', warning: scale.warning }
}

/**
 * Upsert PARTILHADO por adicionar-de-receita (A2) E item avulso (fatia C, #528): insere `lines` na
 * Lista, mesclando na linha existente por `(listId, matchKey, unidade)` — a MESMA regra de soma
 * (NULL nunca vira zero, só soma quando os DOIS lados têm valor) e de proveniência (dec.4:
 * `sourceRecipeId` permanece se BATE com o existente, vira NULL assim que uma fonte DIFERENTE
 * contribui — item avulso sempre entra com `sourceRecipeId: null`, então mesclar um avulso numa
 * linha que já tinha `source_recipe_id` zera a proveniência, coerente com "mesclada de várias
 * fontes"). Extraído de `applyAddRecipeToShoppingList` para NUNCA duplicar este SQL (reuso, não
 * reimplementação — ADR-0032 Consequências).
 */
async function upsertShoppingListLines(input: {
  db: Database
  listId: string
  lines: ShoppingListLineDraft[]
  sourceRecipeId: string | null
}): Promise<void> {
  const { db, listId, lines, sourceRecipeId } = input
  if (lines.length === 0) return

  await db
    .insert(shoppingListItem)
    .values(
      lines.map((l) => ({
        listId,
        nome: l.nome,
        quantidade: l.quantidade,
        unidade: l.unidade,
        ingredientId: l.ingredientId,
        sourceRecipeId,
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
}

/**
 * Adiciona os ingredientes de UMA Receita a uma Lista — o TRACER da fatia A2 (ADR-0032 dec.2/4) +
 * a escala por PORÇÕES-ALVO da fatia B (issue #527, dec.3). Quantidade BASE quando `porcoesAlvo`
 * não é passado; ESCALADA (`base × ratio`) quando passado E a Receita declara `porcoes`. Receita
 * SEM `porcoes` ⇒ BASE + `warning: 'sem_porcoes'` no retorno (o caller/rota decide como exibir).
 *
 * GATE DUPLO, ambos leak-safe no MESMO `not_found` (nunca revela QUAL dos dois falhou):
 *  1. a Lista é do PRÓPRIO usuário (`shopping_list.user_id = userId`);
 *  2. a Receita é ELEGÍVEL pro viewer (ver `addRecipeItemsToList`).
 */
export async function applyAddRecipeToShoppingList(input: {
  db: Database
  userId: string
  listId: string
  recipeId: string
  locale: string
  /** Porções-alvo (fatia B, #527) — `null`/ausente preserva o comportamento BASE da A2. */
  porcoesAlvo?: number | null
}): Promise<ShoppingListAddRecipeResult> {
  const { db, userId, listId, recipeId, locale, porcoesAlvo = null } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const result = await addRecipeItemsToList({ db, userId, listId, recipeId, locale, porcoesAlvo })
  if (result.status === 'ineligible') return { kind: 'not_found' }
  return { kind: 'ok', ...(result.warning ? { warning: result.warning } : {}) }
}

export type ShoppingListAddRecipesResult =
  | { kind: 'ok'; addedCount: number; skippedCount: number }
  | { kind: 'not_found' }

/**
 * Multi-adicionar (fatia E, issue #530, ADR-0032 dec.7): adiciona os ingredientes de N Receitas
 * SELECIONADAS a uma Lista NUMA ação, todas na quantidade BASE (SEM seletor de porções por
 * Receita — dec.7 é explícita: escalar fica no fluxo de UMA Receita, fatia B, pra evitar um
 * seletor por item numa grade de seleção). Reusa o MESMO núcleo de merge/upsert da A2
 * (`addRecipeItemsToList`), UMA VEZ por Receita, sequencialmente — então as linhas de TODAS as
 * Receitas somam por chave+unidade exatamente como re-adicionar a mesma Receita várias vezes
 * (idempotente).
 *
 * A Lista é validada UMA VEZ (não por Receita); Receitas INELEGÍVEIS (não existem, ou o viewer não
 * pode adicioná-las — mesmo gate de Salvar) são PULADAS silenciosamente (contam em `skippedCount`)
 * em vez de derrubar o lote inteiro — o caso comum é a UI só oferecer Receitas já elegíveis (ex.
 * a tela de Salvos), então "pular" só cobre a corrida rara de uma Receita sumir/virar privada
 * entre o carregar da tela e o clique. `recipeIds` chega DEDUPLICADO e dentro do teto
 * (`MAX_RECIPES_PER_BATCH_ADD`) — responsabilidade da rota.
 */
export async function applyAddRecipesToShoppingList(input: {
  db: Database
  userId: string
  listId: string
  recipeIds: readonly string[]
  locale: string
}): Promise<ShoppingListAddRecipesResult> {
  const { db, userId, listId, recipeIds, locale } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  let addedCount = 0
  let skippedCount = 0
  // Sequencial, NUNCA em paralelo: statements concorrentes mirando a MESMA linha (list, matchKey,
  // unidade) disputariam o upsert — serial garante que cada Receita vê o estado que a anterior
  // deixou (a mesma disciplina do usuário chamando o endpoint de UMA Receita N vezes seguidas).
  for (const recipeId of recipeIds) {
    // Multi-adicionar chama SEM `porcoesAlvo` (dec.7): BASE, sem escala. O `warning` do núcleo é
    // ignorado aqui — não há seletor de porções por Receita no lote (o aviso não teria onde ir).
    const result = await addRecipeItemsToList({ db, userId, listId, recipeId, locale })
    if (result.status === 'ok') addedCount += 1
    else skippedCount += 1
  }

  return { kind: 'ok', addedCount, skippedCount }
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

// ── Edição à mão (fatia C, issue #528, ADR-0032 dec.5) ───────────────────────────

export type ShoppingListAddAdhocResult =
  | { kind: 'ok' }
  | { kind: 'invalid_nome' }
  | { kind: 'invalid_quantidade' }
  | { kind: 'invalid_unidade' }
  | { kind: 'not_found' }

/**
 * Adiciona um item AVULSO (digitado à mão) a uma Lista do próprio usuário (ADR-0032 dec.5): nome
 * OBRIGATÓRIO, quantidade/unidade OPCIONAIS (mesmo enum de unidade dos itens de Receita). Gate de
 * dono PRIMEIRO (mesma ordem de `applyAddRecipeToShoppingList`) — lista de outro ⇒ `not_found`
 * ANTES de validar o corpo, nunca revela se o corpo seria válido para uma lista alheia.
 *
 * AGREGA por nome com os demais (mesma chave de `computeMatchKey` da A2 — `ingredientId: null`
 * sempre, pois um item avulso nunca resolve a um Ingrediente canônico): re-adicionar o mesmo nome
 * mescla na linha existente, some `sourceRecipeId: null` sempre (o upsert PARTILHADO já zera a
 * proveniência quando uma fonte diferente contribui — ver `upsertShoppingListLines`).
 */
export async function applyAddAdhocItemToShoppingList(input: {
  db: Database
  userId: string
  listId: string
  nome: string
  quantidade: string | null
  unidade: string | null
}): Promise<ShoppingListAddAdhocResult> {
  const { db, userId, listId, nome, quantidade, unidade } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const v = validateAdhocItem({ nome, quantidade, unidade })
  if (!v.ok) {
    if (v.reason === 'nome_invalido') return { kind: 'invalid_nome' }
    if (v.reason === 'unidade_invalida') return { kind: 'invalid_unidade' }
    return { kind: 'invalid_quantidade' }
  }

  const matchKey = computeMatchKey({ ingredientId: null, nome: v.nome })
  const line: ShoppingListLineDraft = {
    matchKey,
    unidade: v.unidade,
    nome: v.nome,
    quantidade: v.quantidade,
    ingredientId: null,
  }

  await upsertShoppingListLines({ db, listId, lines: [line], sourceRecipeId: null })

  return { kind: 'ok' }
}

export type ShoppingListEditItemResult =
  | { kind: 'ok' }
  | { kind: 'invalid_quantidade' }
  | { kind: 'not_found' }

/**
 * Edita a `quantidade` de UMA linha de uma Lista do próprio usuário (ADR-0032 dec.5). `null` limpa
 * a quantidade (linha vira "sem número", como `a_gosto`/`q.b.`); string presente precisa bater o
 * formato numeric(10,3) POSITIVO (`isValidItemQuantidade`). GATE DUPLO leak-safe: a Lista é do
 * PRÓPRIO usuário E o Item pertence a ESSA Lista — ambos colapsam no MESMO `not_found` (nunca
 * revela se o item existe em OUTRA lista). Nunca mexe em `nome`/`unidade`/`ingredientId`/
 * `matchKey`/`sourceRecipeId` (só a quantidade muda — trocar nome/unidade re-classificaria a linha
 * para outra chave de agregação, fora do escopo desta ação).
 */
export async function applyEditShoppingListItemQuantidade(input: {
  db: Database
  userId: string
  listId: string
  itemId: string
  quantidade: string | null
}): Promise<ShoppingListEditItemResult> {
  const { db, userId, listId, itemId, quantidade } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  if (!isValidItemQuantidade(quantidade)) return { kind: 'invalid_quantidade' }

  const [row] = await db
    .update(shoppingListItem)
    .set({ quantidade, updatedAt: new Date() })
    .where(and(eq(shoppingListItem.id, itemId), eq(shoppingListItem.listId, listId)))
    .returning({ id: shoppingListItem.id })
  if (!row) return { kind: 'not_found' }

  return { kind: 'ok' }
}

export type ShoppingListRemoveItemResult = { kind: 'ok' } | { kind: 'not_found' }

/**
 * Remove UMA linha de uma Lista do próprio usuário (ADR-0032 dec.5). GATE DUPLO leak-safe igual ao
 * de editar (lista de outro / item de outra lista ⇒ o MESMO `not_found`). Ação direta, sem
 * confirmação no servidor (a UI confirma antes de chamar, como `CollectionActions`/apagar Lista).
 */
export async function applyRemoveShoppingListItem(input: {
  db: Database
  userId: string
  listId: string
  itemId: string
}): Promise<ShoppingListRemoveItemResult> {
  const { db, userId, listId, itemId } = input

  const [list] = await db
    .select({ id: shoppingList.id })
    .from(shoppingList)
    .where(and(eq(shoppingList.id, listId), eq(shoppingList.userId, userId)))
  if (!list) return { kind: 'not_found' }

  const [row] = await db
    .delete(shoppingListItem)
    .where(and(eq(shoppingListItem.id, itemId), eq(shoppingListItem.listId, listId)))
    .returning({ id: shoppingListItem.id })
  if (!row) return { kind: 'not_found' }

  return { kind: 'ok' }
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
