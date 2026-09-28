import { and, asc, eq, gte, isNull, lte, ne, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { mealPlanEntry, recipe, recipeImage, shoppingList } from '@/db/schema'
import {
  MAX_MEAL_PLAN_ENTRIES_PER_DAY,
  compareMealPlanEntries,
  rangeLength,
  type MealSlot,
  type PlanRange,
} from '@/domain/meal-plan'
import { eligibleToSaveByViewer } from '@/domain/recipe-pool'
import type { RecipeListItem } from '@/domain/recipe-list-read'
import { pgCode } from '@/server/recipe/visibility'
import { RECIPE_LIST_COLS, hydrateRecipeListItems } from '@/server/recipe/collections'
import {
  applyAddPlannedRecipesToShoppingList,
  applyShoppingListCreate,
  type Tx,
} from '@/server/shopping-list/shopping-list'

/**
 * Núcleo com efeito do Plano de refeições (ADR-0035). Espelha a disciplina da Lista de compras
 * (`@/server/shopping-list/shopping-list`): `db` por parâmetro, discriminated unions que as rotas
 * mapeiam a HTTP, e PRIVACIDADE por construção — toda função escopa por `meal_plan_entry.user_id =
 * userId`; "não é sua" e "não existe" colapsam no MESMO `not_found` (404 leak-safe).
 *
 * GATE da Receita = o de Salvar (`eligibleToSaveByViewer`, ADR-0027 D2), o mesmo da Lista: pool
 * público OU a própria Receita, mesmo privada. Aplicado ao PLANEJAR (inelegível ⇒ not_found) e ao
 * LER (a Receita que ficou inelegível depois segue no plano como "indisponível", sem título — dec.3).
 */

/**
 * Teto de linhas que uma leitura de `range` pode trazer: o cap por dia × dias. O cap é checado antes
 * do INSERT sem trava (corrida no limite é aceitável), então isto é defesa em profundidade — um dia
 * inflado por requisições paralelas não vira uma leitura (ou um "gerar lista") sem fim.
 */
function maxEntriesIn(range: PlanRange): number {
  return rangeLength(range.from, range.to) * MAX_MEAL_PLAN_ENTRIES_PER_DAY
}

// ── Tipos ────────────────────────────────────────────────────────────────────────

/** Receita resumida de uma Refeição planejada: o card de lista + as porções que ela declara. */
export type MealPlanRecipe = Pick<
  RecipeListItem,
  'id' | 'name' | 'slug' | 'imageUrl' | 'imageAiGenerated'
> & { porcoes: number | null }

export type MealPlanEntryView = {
  id: string
  day: string
  slot: MealSlot
  /** Porções-alvo gravadas; `null` = as da Receita. */
  porcoes: number | null
  createdAt: string
  /** `null` = a Receita ficou inelegível pro dono do plano (privada de 3º, removida…). */
  recipe: MealPlanRecipe | null
}

export type MealPlanAddResult =
  | { kind: 'ok'; entryId: string }
  | { kind: 'not_found' }
  | { kind: 'day_full' }

export type MealPlanUpdateResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'duplicate' }
  | { kind: 'day_full' }

export type MealPlanRemoveResult = { kind: 'ok' } | { kind: 'not_found' }

export type MealPlanToShoppingListResult =
  | {
      kind: 'ok'
      list: { id: string; name: string }
      addedCount: number
      skippedCount: number
      semPorcoesCount: number
    }
  | { kind: 'not_found' }
  | { kind: 'empty' }
  | { kind: 'invalid_name' }
  | { kind: 'duplicate_name' }
  | { kind: 'limit_reached' }

// ── Interno ──────────────────────────────────────────────────────────────────────

export const GATE_COLS = {
  ownerId: recipe.ownerId,
  visibility: recipe.visibility,
  resultKind: recipe.resultKind,
  moderationRemovedAt: recipe.moderationRemovedAt,
  origin: recipe.origin,
  curationStatus: recipe.curationStatus,
} as const

export async function countEntriesOnDay(db: Database | Tx, userId: string, day: string, excludeId?: string) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mealPlanEntry)
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        eq(mealPlanEntry.day, day),
        excludeId ? ne(mealPlanEntry.id, excludeId) : undefined,
      ),
    )
  return n
}

// ── Planejar ─────────────────────────────────────────────────────────────────────

/**
 * Planeja UMA Receita num dia/refeição (ADR-0035 dec.1/4). Receita inelegível ⇒ `not_found`
 * (leak-safe, como adicionar à lista). Re-planejar a MESMA Receita no MESMO dia+refeição é UPSERT
 * das porções (UNIQUE user+day+slot+recipe; sem porções no pedido, mantém as gravadas) — idempotente sob duplo clique, não conta no teto. O
 * teto por dia (`MAX_MEAL_PLAN_ENTRIES_PER_DAY`) só barra uma entrada NOVA.
 */
export async function applyAddMealPlanEntry(input: {
  db: Database
  userId: string
  recipeId: string
  day: string
  slot: MealSlot
  porcoes: number | null
}): Promise<MealPlanAddResult> {
  const { db, userId, recipeId, day, slot, porcoes } = input

  const [gate] = await db.select(GATE_COLS).from(recipe).where(eq(recipe.id, recipeId))
  if (!gate || !eligibleToSaveByViewer(gate, userId)) return { kind: 'not_found' }

  const [existing] = await db
    .select({ id: mealPlanEntry.id })
    .from(mealPlanEntry)
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        eq(mealPlanEntry.day, day),
        eq(mealPlanEntry.slot, slot),
        eq(mealPlanEntry.recipeId, recipeId),
      ),
    )
  if (!existing && (await countEntriesOnDay(db, userId, day)) >= MAX_MEAL_PLAN_ENTRIES_PER_DAY) {
    return { kind: 'day_full' }
  }

  const [row] = await db
    .insert(mealPlanEntry)
    .values({ userId, day, slot, recipeId, porcoes })
    .onConflictDoUpdate({
      target: [mealPlanEntry.userId, mealPlanEntry.day, mealPlanEntry.slot, mealPlanEntry.recipeId],
      // Re-planejar SEM porções (o seletor do Cardápio não manda) preserva as já ajustadas; com
      // porções (o botão do detalhe manda as da tela), elas valem.
      set: { porcoes: sql`coalesce(excluded.porcoes, ${mealPlanEntry.porcoes})`, updatedAt: sql`now()` },
    })
    .returning({ id: mealPlanEntry.id })

  return { kind: 'ok', entryId: row.id }
}

/**
 * Move (dia/refeição) e/ou ajusta as porções de UMA Refeição planejada do próprio usuário. Campos
 * ausentes ficam como estão; `porcoes: null` volta às porções da Receita. Mover pra um dia cheio ⇒
 * `day_full`; mover pra onde a MESMA Receita já está planejada ⇒ `duplicate` (colisão na UNIQUE —
 * a UI avisa em vez de fundir em silêncio).
 */
export async function applyUpdateMealPlanEntry(input: {
  db: Database
  userId: string
  entryId: string
  day?: string
  slot?: MealSlot
  porcoes?: number | null
}): Promise<MealPlanUpdateResult> {
  const { db, userId, entryId, day, slot, porcoes } = input

  const [current] = await db
    .select({ id: mealPlanEntry.id, day: mealPlanEntry.day })
    .from(mealPlanEntry)
    .where(and(eq(mealPlanEntry.id, entryId), eq(mealPlanEntry.userId, userId)))
  if (!current) return { kind: 'not_found' }

  if (day !== undefined && day !== current.day) {
    if ((await countEntriesOnDay(db, userId, day, entryId)) >= MAX_MEAL_PLAN_ENTRIES_PER_DAY) {
      return { kind: 'day_full' }
    }
  }

  try {
    const [row] = await db
      .update(mealPlanEntry)
      .set({
        ...(day !== undefined ? { day } : {}),
        ...(slot !== undefined ? { slot } : {}),
        ...(porcoes !== undefined ? { porcoes } : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(mealPlanEntry.id, entryId), eq(mealPlanEntry.userId, userId)))
      .returning({ id: mealPlanEntry.id })
    if (!row) return { kind: 'not_found' }
    return { kind: 'ok' }
  } catch (e) {
    if (pgCode(e) === '23505') return { kind: 'duplicate' }
    throw e
  }
}

/** Tira UMA Refeição planejada do plano do próprio usuário (DELETE escopado ⇒ vazio = not_found). */
export async function applyRemoveMealPlanEntry(input: {
  db: Database
  userId: string
  entryId: string
}): Promise<MealPlanRemoveResult> {
  const { db, userId, entryId } = input
  const [row] = await db
    .delete(mealPlanEntry)
    .where(and(eq(mealPlanEntry.id, entryId), eq(mealPlanEntry.userId, userId)))
    .returning({ id: mealPlanEntry.id })
  return row ? { kind: 'ok' } : { kind: 'not_found' }
}

// ── Ler ──────────────────────────────────────────────────────────────────────────

/**
 * As Refeições planejadas do usuário no intervalo `[from, to]` (inclusivo, já validado pela rota),
 * ordenadas por dia → refeição do dia → criação. A Receita vem como o MESMO card de Salvos/Coleções
 * (`hydrateRecipeListItems` — título por locale, slug, thumbnail sem imagem moderada) + as porções
 * que ela declara (o default do seletor de porções). Receita inelegível ⇒ `recipe: null` (dec.3): o
 * dono vê que a refeição existe e pode tirá-la, sem vazar o título de uma Receita que ele não lê mais.
 */
export async function loadMealPlan(input: {
  db: Database
  userId: string
  range: PlanRange
  requestLocale: string
  fallbackName: string
}): Promise<MealPlanEntryView[]> {
  const { db, userId, range, requestLocale, fallbackName } = input

  const rows = await db
    .select({
      entryId: mealPlanEntry.id,
      day: mealPlanEntry.day,
      slot: mealPlanEntry.slot,
      entryPorcoes: mealPlanEntry.porcoes,
      entryCreatedAt: mealPlanEntry.createdAt,
      recipePorcoes: recipe.porcoes,
      gate: GATE_COLS,
      ...RECIPE_LIST_COLS,
    })
    .from(mealPlanEntry)
    .innerJoin(recipe, eq(recipe.id, mealPlanEntry.recipeId))
    .leftJoin(recipeImage, and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)))
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        gte(mealPlanEntry.day, range.from),
        lte(mealPlanEntry.day, range.to),
      ),
    )
    .orderBy(asc(mealPlanEntry.day), asc(mealPlanEntry.createdAt), asc(mealPlanEntry.id))
    .limit(maxEntriesIn(range))

  const eligible = rows.filter((r) => eligibleToSaveByViewer(r.gate, userId))

  // Hidrata cada Receita UMA vez (a mesma Receita pode estar em vários dias).
  const uniqueEligible = [...new Map(eligible.map((r) => [r.id, r])).values()]
  const cards = await hydrateRecipeListItems(db, uniqueEligible, requestLocale, fallbackName)
  const cardById = new Map(cards.map((c) => [c.id, c]))

  const entries: MealPlanEntryView[] = rows.map((r) => {
    // Elegibilidade depende só da Receita e do viewer, e `cardById` só tem as elegíveis.
    const card = cardById.get(r.id)
    return {
      id: r.entryId,
      day: r.day,
      slot: r.slot,
      porcoes: r.entryPorcoes,
      createdAt: r.entryCreatedAt.toISOString(),
      recipe: card
        ? {
            id: card.id,
            name: card.name,
            porcoes: r.recipePorcoes,
            ...(card.slug !== undefined ? { slug: card.slug } : {}),
            ...(card.imageUrl !== undefined ? { imageUrl: card.imageUrl } : {}),
            ...(card.imageAiGenerated ? { imageAiGenerated: true } : {}),
          }
        : null,
    }
  })
  return entries.sort(compareMealPlanEntries)
}

// ── Plano → Lista de compras ─────────────────────────────────────────────────────

/**
 * "Gerar lista de compras" (ADR-0035 dec.5): joga na Lista de destino (existente do usuário ou nova) os
 * ingredientes de TODAS as Refeições planejadas em `[from, to]`, cada uma escalada pelas suas
 * porções (via `applyAddPlannedRecipesToShoppingList` — o MESMO núcleo de merge/agregação/snapshot do
 * ADR-0032). Intervalo sem nenhuma Refeição ⇒ `empty` (a UI avisa; nada a fazer). A ordem é a do
 * plano (dia → refeição), então as linhas da lista nascem na ordem em que se vai cozinhar.
 */
export async function applyMealPlanToShoppingList(input: {
  db: Database
  userId: string
  /** Lista existente do usuário, ou o NOME de uma nova — criada só se o período tiver refeições. */
  target: { listId: string } | { newListName: string }
  range: PlanRange
  locale: string
}): Promise<MealPlanToShoppingListResult> {
  const { db, userId, target, range, locale } = input

  const rows = await db
    .select({
      recipeId: mealPlanEntry.recipeId,
      porcoes: mealPlanEntry.porcoes,
      day: mealPlanEntry.day,
      slot: mealPlanEntry.slot,
      createdAt: mealPlanEntry.createdAt,
    })
    .from(mealPlanEntry)
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        gte(mealPlanEntry.day, range.from),
        lte(mealPlanEntry.day, range.to),
      ),
    )
    .orderBy(asc(mealPlanEntry.day), asc(mealPlanEntry.createdAt), asc(mealPlanEntry.id))
    .limit(maxEntriesIn(range))

  const ordered = rows
    .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))
    .sort(compareMealPlanEntries)

  // Lista existente: a posse é checada ANTES de dizer se o período está vazio (404 não revela nada).
  // Lista nova: período vazio NÃO cria nada — nunca sobra uma lista órfã de um "gerar" que não gerou.
  const entries = ordered.map((r) => ({ recipeId: r.recipeId, porcoesAlvo: r.porcoes }))

  if ('listId' in target) {
    const [own] = await db
      .select({ id: shoppingList.id, name: shoppingList.name })
      .from(shoppingList)
      .where(and(eq(shoppingList.id, target.listId), eq(shoppingList.userId, userId)))
    if (!own) return { kind: 'not_found' }
    if (entries.length === 0) return { kind: 'empty' }
    const res = await applyAddPlannedRecipesToShoppingList({ db, userId, listId: own.id, entries, locale })
    if (res.kind === 'not_found') return res
    return { ...res, list: own }
  }

  if (entries.length === 0) return { kind: 'empty' }
  // Criar a lista e somar nela na MESMA transação: se a soma falhar no meio, a lista nova também
  // some (um retry com o mesmo nome não esbarra num `nome_duplicado` de uma lista vazia).
  // Se NENHUMA Receita do período pôde entrar (todas ficaram indisponíveis), desfaz a criação: lista
  // nova vazia também seria órfã. Um throw é o jeito de o drizzle dar ROLLBACK.
  try {
    return await db.transaction(async (tx) => {
      const created = await applyShoppingListCreate({ db: tx, userId, name: target.newListName })
      if (created.kind !== 'ok') return created
      const list = { id: created.list.id, name: created.list.name }
      const res = await applyAddPlannedRecipesToShoppingList({ db: tx, userId, listId: list.id, entries, locale })
      if (res.kind === 'not_found') return res
      if (res.addedCount === 0) throw new NothingAddedRollback()
      return { ...res, list }
    })
  } catch (e) {
    if (e instanceof NothingAddedRollback) return { kind: 'empty' }
    throw e
  }
}

class NothingAddedRollback extends Error {}
