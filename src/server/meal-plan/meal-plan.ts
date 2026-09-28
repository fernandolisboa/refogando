import { and, asc, eq, gte, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { mealPlanEntry, recipe, recipeImage, shoppingList } from '@/db/schema'
import {
  MAX_MEAL_PLAN_ENTRIES_PER_DAY,
  addDays,
  compareMealPlanEntries,
  planPreviousWeekCopy,
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
 *
 * ANOTAÇÃO (ADR-0037): uma entrada pode ser, no lugar da Receita, um texto livre curto ("jantar fora",
 * "sobras"). Ocupa a refeição do dia (conta no teto, preenche o buraco pra Sugestão e pra cópia), mas
 * não tem porções e nunca vai pra Lista de compras.
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
  /** Porções-alvo gravadas; `null` = as da Receita (Anotação: sempre `null`). */
  porcoes: number | null
  createdAt: string
  /** Anotação livre (ADR-0037); `null` numa entrada de Receita. */
  note: string | null
  /**
   * `null` numa Anotação (`note` preenchida) ou quando a Receita ficou inelegível pro dono do plano
   * (privada de 3º, removida…).
   */
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
  /** Porções numa Anotação (não há o que escalar). */
  | { kind: 'invalid' }

export type MealPlanCopyResult =
  | { kind: 'ok'; addedCount: number; skippedCount: number }
  /** A semana anterior não tem nada que caia no período pedido. */
  | { kind: 'empty_source' }

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
 * Anota um texto livre num dia/refeição (ADR-0037) — "jantar fora", "sobras". `note` já vem
 * normalizada (`parsePlanNote`). A MESMA anotação na MESMA refeição é idempotente (UNIQUE user+day+
 * slot+note; duplo clique devolve a mesma entrada) e não conta no teto; uma nova respeita o teto.
 */
export async function applyAddMealPlanNote(input: {
  db: Database
  userId: string
  day: string
  slot: MealSlot
  note: string
}): Promise<MealPlanAddResult> {
  const { db, userId, day, slot, note } = input

  const [existing] = await db
    .select({ id: mealPlanEntry.id })
    .from(mealPlanEntry)
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        eq(mealPlanEntry.day, day),
        eq(mealPlanEntry.slot, slot),
        eq(mealPlanEntry.note, note),
      ),
    )
  if (existing) return { kind: 'ok', entryId: existing.id }
  if ((await countEntriesOnDay(db, userId, day)) >= MAX_MEAL_PLAN_ENTRIES_PER_DAY) {
    return { kind: 'day_full' }
  }

  const [row] = await db
    .insert(mealPlanEntry)
    .values({ userId, day, slot, note })
    .onConflictDoUpdate({
      target: [mealPlanEntry.userId, mealPlanEntry.day, mealPlanEntry.slot, mealPlanEntry.note],
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: mealPlanEntry.id })

  return { kind: 'ok', entryId: row.id }
}

/**
 * Move (dia/refeição) e/ou ajusta as porções de UMA Refeição planejada do próprio usuário. Campos
 * ausentes ficam como estão; `porcoes: null` volta às porções da Receita. Mover pra um dia cheio ⇒
 * `day_full`; mover pra onde a MESMA Receita (ou a mesma Anotação) já está ⇒ `duplicate` (colisão na
 * UNIQUE — a UI avisa em vez de fundir em silêncio). Porções numa Anotação ⇒ `invalid` (ADR-0037).
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
    .select({ id: mealPlanEntry.id, day: mealPlanEntry.day, recipeId: mealPlanEntry.recipeId })
    .from(mealPlanEntry)
    .where(and(eq(mealPlanEntry.id, entryId), eq(mealPlanEntry.userId, userId)))
  if (!current) return { kind: 'not_found' }
  // Anotação não tem porções (o CHECK do banco barraria com um 500; aqui vira 400). `null` é inofensivo.
  if (porcoes != null && current.recipeId == null) return { kind: 'invalid' }

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
 * As Anotações (ADR-0037) vêm numa segunda leitura, sem join, e entram na mesma ordenação.
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

  const noteRows = await db
    .select({
      id: mealPlanEntry.id,
      day: mealPlanEntry.day,
      slot: mealPlanEntry.slot,
      note: mealPlanEntry.note,
      createdAt: mealPlanEntry.createdAt,
    })
    .from(mealPlanEntry)
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        gte(mealPlanEntry.day, range.from),
        lte(mealPlanEntry.day, range.to),
        isNotNull(mealPlanEntry.note),
      ),
    )
    .orderBy(asc(mealPlanEntry.day), asc(mealPlanEntry.createdAt), asc(mealPlanEntry.id))
    .limit(maxEntriesIn(range))
  const notes: MealPlanEntryView[] = noteRows.map((r) => ({
    id: r.id,
    day: r.day,
    slot: r.slot,
    porcoes: null,
    createdAt: r.createdAt.toISOString(),
    note: r.note,
    recipe: null,
  }))

  const entries: MealPlanEntryView[] = rows.map((r) => {
    // Elegibilidade depende só da Receita e do viewer, e `cardById` só tem as elegíveis.
    const card = cardById.get(r.id)
    return {
      id: r.entryId,
      day: r.day,
      slot: r.slot,
      porcoes: r.entryPorcoes,
      createdAt: r.entryCreatedAt.toISOString(),
      note: null,
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
  return [...entries, ...notes].sort(compareMealPlanEntries)
}

// ── Plano → Lista de compras ─────────────────────────────────────────────────────

/**
 * "Gerar lista de compras" (ADR-0035 dec.5): joga na Lista de destino (existente do usuário ou nova) os
 * ingredientes de TODAS as Refeições planejadas em `[from, to]`, cada uma escalada pelas suas
 * porções (via `applyAddPlannedRecipesToShoppingList` — o MESMO núcleo de merge/agregação/snapshot do
 * ADR-0032). Intervalo sem nenhuma Refeição ⇒ `empty` (a UI avisa; nada a fazer). A ordem é a do
 * plano (dia → refeição), então as linhas da lista nascem na ordem em que se vai cozinhar. Anotações
 * (ADR-0037) não têm ingredientes: ficam de fora (um período só com anotações é `empty`).
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
        isNotNull(mealPlanEntry.recipeId),
      ),
    )
    .orderBy(asc(mealPlanEntry.day), asc(mealPlanEntry.createdAt), asc(mealPlanEntry.id))
    .limit(maxEntriesIn(range))

  const ordered = rows
    .flatMap((r) => (r.recipeId == null ? [] : [{ ...r, recipeId: r.recipeId, createdAt: r.createdAt.toISOString() }]))
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

// ── Copiar a semana anterior (ADR-0037) ──────────────────────────────────────────

/**
 * "Copiar semana anterior": repete no destino as Refeições planejadas da semana de `week - 7` (Receitas
 * com as porções gravadas e Anotações), dia a dia. `week` é a SEGUNDA do destino (validada na rota);
 * `fromDay` (dentro da semana) corta o começo — na semana corrente o cliente manda hoje, pra não
 * preencher dias que já passaram. O plano é o do kernel puro `planPreviousWeekCopy`: só preenche
 * refeições do dia VAZIAS no destino, respeita o teto por dia.
 *
 * Privacidade: origem e destino escopados por `user_id` da sessão; cada Receita da origem passa DE NOVO
 * pelo gate de Salvar (ficou inelegível desde a semana passada ⇒ não é copiada, conta como pulada).
 * Escrita numa transação, com `ON CONFLICT DO NOTHING` nas duas UNIQUEs: um duplo clique não duplica.
 */
export async function applyCopyPreviousWeek(input: {
  db: Database
  userId: string
  week: string
  fromDay?: string
}): Promise<MealPlanCopyResult> {
  const { db, userId, week } = input
  const target: PlanRange = { from: input.fromDay ?? week, to: addDays(week, 6) }
  const source: PlanRange = { from: addDays(target.from, -7), to: addDays(target.to, -7) }

  const sourceRows = await db
    .select({
      day: mealPlanEntry.day,
      slot: mealPlanEntry.slot,
      recipeId: mealPlanEntry.recipeId,
      note: mealPlanEntry.note,
      porcoes: mealPlanEntry.porcoes,
      createdAt: mealPlanEntry.createdAt,
      // Colunas do gate SOLTAS (não o objeto `GATE_COLS`): num leftJoin o drizzle anula o objeto
      // aninhado quando a 1ª coluna dele é NULL — e `owner_id` é NULL em toda Receita de catálogo.
      recipeVisibility: recipe.visibility,
      recipeOwnerId: recipe.ownerId,
      recipeResultKind: recipe.resultKind,
      recipeModerationRemovedAt: recipe.moderationRemovedAt,
      recipeOrigin: recipe.origin,
      recipeCurationStatus: recipe.curationStatus,
    })
    .from(mealPlanEntry)
    .leftJoin(recipe, eq(recipe.id, mealPlanEntry.recipeId))
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        gte(mealPlanEntry.day, source.from),
        lte(mealPlanEntry.day, source.to),
      ),
    )
    .limit(maxEntriesIn(source))
  if (sourceRows.length === 0) return { kind: 'empty_source' }

  // Receita que ficou inelegível pro dono do plano não é copiada (nem vira "indisponível" de novo).
  const copyable = sourceRows.flatMap((r) => {
    const entry = {
      day: r.day,
      slot: r.slot,
      recipeId: r.recipeId,
      note: r.note,
      porcoes: r.porcoes,
      createdAt: r.createdAt.toISOString(),
    }
    if (r.recipeId == null) return r.note == null ? [] : [entry]
    if (r.recipeVisibility == null || r.recipeResultKind == null || r.recipeOrigin == null || r.recipeCurationStatus == null) {
      return []
    }
    const gate = {
      ownerId: r.recipeOwnerId,
      visibility: r.recipeVisibility,
      resultKind: r.recipeResultKind,
      moderationRemovedAt: r.recipeModerationRemovedAt,
      origin: r.recipeOrigin,
      curationStatus: r.recipeCurationStatus,
    }
    return eligibleToSaveByViewer(gate, userId) ? [entry] : []
  })
  const unavailableCount = sourceRows.length - copyable.length

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ day: mealPlanEntry.day, slot: mealPlanEntry.slot })
      .from(mealPlanEntry)
      .where(
        and(
          eq(mealPlanEntry.userId, userId),
          gte(mealPlanEntry.day, target.from),
          lte(mealPlanEntry.day, target.to),
        ),
      )
      .limit(maxEntriesIn(target))

    const { toInsert, skippedCount } = planPreviousWeekCopy(copyable, existing, {
      targetFrom: target.from,
      targetTo: target.to,
    })

    // UM INSERT multi-linha (≤ 7 × teto). Sem alvo no ON CONFLICT: cobre as DUAS UNIQUEs (Receita e
    // Anotação) — duplo clique vira no-op.
    const inserted =
      toInsert.length === 0
        ? []
        : await tx
            .insert(mealPlanEntry)
            .values(
              toInsert.map((e) =>
                e.recipeId != null
                  ? { userId, day: e.day, slot: e.slot, recipeId: e.recipeId, note: null, porcoes: e.porcoes }
                  : { userId, day: e.day, slot: e.slot, recipeId: null, note: e.note, porcoes: null },
              ),
            )
            .onConflictDoNothing()
            .returning({ id: mealPlanEntry.id })
    const addedCount = inserted.length
    return {
      kind: 'ok' as const,
      addedCount,
      skippedCount: skippedCount + unavailableCount + (toInsert.length - addedCount),
    }
  })
}
