import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { mealPlanEntry, mealPlanSuggestionEvent, recipe, recipeImage } from '@/db/schema'
import {
  MAX_MEAL_PLAN_ENTRIES_PER_DAY,
  rangeLength,
  type MealSlot,
  type PlanRange,
} from '@/domain/meal-plan'
import {
  MENU_CANDIDATES_OWN_MAX,
  MENU_CANDIDATES_TOTAL_MAX,
  categoriasForSlots,
  type MenuApplyEntry,
  type MenuCandidate,
  type MenuSource,
} from '@/domain/menu-suggestion'
import { eligibleToSaveByViewer } from '@/domain/recipe-pool'
import type { RecipeListItem } from '@/domain/recipe-list-read'
import { computeTextCost, type TextUsage } from '@/domain/text-cost'
import type { Categoria, Restricao } from '@/domain/vocabulary'
import { RECIPE_LIST_COLS, hydrateRecipeListItems } from '@/server/recipe/collections'
import {
  communityVisibleSqlFragment,
  poolBarriersSqlFragment,
  viewerReadableSqlFragment,
} from '@/server/recipe/visibility-sql'
import { GATE_COLS, countEntriesOnDay } from '@/server/meal-plan/meal-plan'

/**
 * Núcleo com efeito da Sugestão de cardápio (ADR-0036): carrega o que já está planejado na semana, as
 * Receitas CANDIDATAS (o acervo do Usuário + uma amostra do pool público), os cards da prévia, o custo da
 * chamada no ledger da cota, e o ACEITE (entradas re-validadas uma a uma, numa transação).
 *
 * Privacidade por construção, como o resto do Cardápio: as candidatas do acervo passam pelo MESMO gate
 * de Salvar (`viewerReadableSqlFragment` + as barreiras do pool — a leitura de `loadSavedRecipes`), as do
 * pool público pelo gate de comunidade; uma Receita privada de outro nunca entra no prompt. O aceite não
 * confia na prévia: cada entrada passa de novo por `eligibleToSaveByViewer` e pelo teto por dia.
 */

// ── Plano da semana ──────────────────────────────────────────────────────────────

/** `recipeId: null` = Anotação (ADR-0037): ocupa a refeição, mas o texto dela NUNCA é lido aqui (nem vai ao prompt). */
export type PlannedSlot = { day: string; slot: MealSlot; recipeId: string | null }

/** O que já está planejado em `range` (só dia/refeição/Receita — sem hidratar cards). */
export async function loadPlannedSlots(input: {
  db: Database
  userId: string
  range: PlanRange
}): Promise<PlannedSlot[]> {
  const { db, userId, range } = input
  return db
    .select({ day: mealPlanEntry.day, slot: mealPlanEntry.slot, recipeId: mealPlanEntry.recipeId })
    .from(mealPlanEntry)
    .where(
      and(
        eq(mealPlanEntry.userId, userId),
        gte(mealPlanEntry.day, range.from),
        lte(mealPlanEntry.day, range.to),
      ),
    )
    .limit(rangeLength(range.from, range.to) * MAX_MEAL_PLAN_ENTRIES_PER_DAY)
}

// ── Candidatas ───────────────────────────────────────────────────────────────────

type CandidateRow = {
  id: string
  titulo: string | null
  cozinha: string | null
  categoria: string | null
  restricoes: string[] | null
  tempo_total_min: number | null
  dificuldade: number | null
}

/** Barreiras do pool que valem pra QUALQUER candidata (espelham `passesOwnRecipeBarriers`). */
const BARRIERS = poolBarriersSqlFragment('r')

/**
 * Filtros do pedido: a Receita declara TODAS as restrições pedidas (o modelo nunca decide isso), e a
 * categoria serve a alguma das refeições pedidas (`MENU_SLOT_CATEGORIAS`). Valores já validados contra o
 * vocabulário; vão BINDADOS mesmo assim.
 */
function requestFilters(restricoes: readonly Restricao[], categorias: readonly Categoria[], semCategoria: boolean): SQL {
  const restr =
    restricoes.length > 0
      ? sql`AND r.restricoes @> ARRAY[${sql.join(
          restricoes.map((x) => sql`${x}`),
          sql`, `,
        )}]::restricao[]`
      : sql``
  const cats =
    categorias.length > 0
      ? sql`r.categoria IN (${sql.join(
          categorias.map((c) => sql`${c}::categoria`),
          sql`, `,
        )})`
      : sql`false`
  return sql`${restr} AND (${cats}${semCategoria ? sql` OR r.categoria IS NULL` : sql``})`
}

/** Colunas + título por locale (o do pedido, senão o original) — só o que o prompt usa. */
const CANDIDATE_COLS = sql`r.id, coalesce(t_req.titulo, t_orig.titulo) AS titulo, r.cozinha,
  r.categoria::text AS categoria, r.restricoes::text[] AS restricoes, r.tempo_total_min, r.dificuldade`

function titleJoins(locale: string): SQL {
  return sql`LEFT JOIN recipe_translation t_req ON t_req.recipe_id = r.id AND t_req.locale = ${locale}
    LEFT JOIN recipe_translation t_orig ON t_orig.recipe_id = r.id AND t_orig.locale = r.original_locale`
}

/**
 * As candidatas da sugestão, na ordem em que vão pro prompt (acervo primeiro).
 *  - ACERVO: Salvas pelo Usuário ∪ criadas por ele (mesmo privadas), com o gate de Salvar; mais
 *    recentes primeiro (salva há pouco / editada há pouco), até `MENU_CANDIDATES_OWN_MAX`.
 *  - POOL (só com `source = 'all'`): comunidade + catálogo aprovado, fora do acervo (nem salva nem dele), completando até
 *    `MENU_CANDIDATES_TOTAL_MAX`. Amostra ALEATÓRIA (cada pedido vê outra fatia do pool) com COTA por
 *    categoria: sem ela, uma amostra de pratos principais deixaria o café da manhã sem opção. O
 *    `random()` ordena o pool elegível inteiro — aceito no tamanho de hoje (ADR-0036 dec.3).
 * Receita sem título em nenhum dos dois locales fica de fora (não há o que mostrar ao modelo).
 */
export async function loadMenuCandidates(input: {
  db: Database
  userId: string
  slots: readonly MealSlot[]
  restricoes: readonly Restricao[]
  source: MenuSource
  locale: string
  planned: readonly PlannedSlot[]
}): Promise<MenuCandidate[]> {
  const { db, userId, slots, restricoes, source, locale, planned } = input
  const { categorias, semCategoria } = categoriasForSlots(slots)
  const filters = requestFilters(restricoes, categorias, semCategoria)

  const own = await db.execute<CandidateRow>(sql`
    SELECT ${CANDIDATE_COLS}
    FROM recipe r
    LEFT JOIN recipe_save s ON s.recipe_id = r.id AND s.user_id = ${userId}
    ${titleJoins(locale)}
    WHERE r.id IN (
        SELECT recipe_id FROM recipe_save WHERE user_id = ${userId}
        UNION
        SELECT id FROM recipe WHERE owner_id = ${userId}
      )
      AND ${viewerReadableSqlFragment('r', userId)}
      AND ${BARRIERS}
      ${filters}
    ORDER BY greatest(s.created_at, CASE WHEN r.owner_id = ${userId} THEN r.updated_at END) DESC NULLS LAST, r.id
    LIMIT ${MENU_CANDIDATES_OWN_MAX}
  `)
  const ownRows = [...own].filter((r) => r.titulo != null)

  let poolRows: CandidateRow[] = []
  const poolSlots = MENU_CANDIDATES_TOTAL_MAX - ownRows.length
  if (source === 'all' && poolSlots > 0) {
    const partitions = categorias.length + (semCategoria ? 1 : 0)
    const perCategory = Math.max(1, Math.ceil(poolSlots / Math.max(1, partitions)))
    const pool = await db.execute<CandidateRow>(sql`
      SELECT id, titulo, cozinha, categoria, restricoes, tempo_total_min, dificuldade FROM (
        SELECT ${CANDIDATE_COLS}, row_number() OVER (PARTITION BY r.categoria ORDER BY random()) AS rn
        FROM recipe r
        ${titleJoins(locale)}
        WHERE ${communityVisibleSqlFragment('r')}
          AND ${BARRIERS}
          ${filters}
          -- Fora do acervo INTEIRO (não só das ≤ 100 que entraram): nada do Usuário vem marcado "comunidade".
          AND r.owner_id IS DISTINCT FROM ${userId}
          AND NOT EXISTS (SELECT 1 FROM recipe_save rs WHERE rs.recipe_id = r.id AND rs.user_id = ${userId})
          AND coalesce(t_req.titulo, t_orig.titulo) IS NOT NULL
      ) sample
      WHERE rn <= ${perCategory}
      ORDER BY random()
      LIMIT ${poolSlots}
    `)
    poolRows = [...pool]
  }

  const plannedIds = new Set(planned.map((p) => p.recipeId))
  const toCandidate = (r: CandidateRow, mine: boolean): MenuCandidate => ({
    id: r.id,
    name: r.titulo ?? '',
    cozinha: r.cozinha,
    categoria: r.categoria as Categoria | null,
    restricoes: (r.restricoes ?? []) as Restricao[],
    tempoTotalMin: r.tempo_total_min,
    dificuldade: r.dificuldade,
    mine,
    planned: plannedIds.has(r.id),
  })
  return [...ownRows.map((r) => toCandidate(r, true)), ...poolRows.map((r) => toCandidate(r, false))]
}

// ── Prévia ───────────────────────────────────────────────────────────────────────

/** Card de Receita da prévia (o mesmo recorte do card do Cardápio). */
export type MenuPreviewRecipe = Pick<RecipeListItem, 'id' | 'name' | 'slug' | 'imageUrl' | 'imageAiGenerated'>

/**
 * Cards das Receitas escolhidas (≤ 28), pela MESMA hidratação de Salvos/Cardápio (título por locale,
 * slug, thumbnail sem imagem moderada). Re-aplica o gate de Salvar: se uma candidata ficou inelegível
 * entre o carregamento e aqui, ela some da prévia.
 */
export async function loadMenuPreviewCards(input: {
  db: Database
  userId: string
  recipeIds: readonly string[]
  requestLocale: string
  fallbackName: string
}): Promise<Map<string, MenuPreviewRecipe>> {
  const { db, userId, recipeIds, requestLocale, fallbackName } = input
  if (recipeIds.length === 0) return new Map()
  const rows = await db
    .select({ gate: GATE_COLS, ...RECIPE_LIST_COLS })
    .from(recipe)
    .leftJoin(recipeImage, and(eq(recipeImage.id, recipe.imageId), isNull(recipeImage.moderatedAt)))
    .where(inArray(recipe.id, [...new Set(recipeIds)]))
  const eligible = rows.filter((r) => eligibleToSaveByViewer(r.gate, userId))
  const cards = await hydrateRecipeListItems(db, eligible, requestLocale, fallbackName)
  return new Map(
    cards.map((c) => [
      c.id,
      {
        id: c.id,
        name: c.name,
        ...(c.slug !== undefined ? { slug: c.slug } : {}),
        ...(c.imageUrl !== undefined ? { imageUrl: c.imageUrl } : {}),
        ...(c.imageAiGenerated ? { imageAiGenerated: true } : {}),
      },
    ]),
  )
}

// ── Custo ────────────────────────────────────────────────────────────────────────

/**
 * Completa a linha do ledger reservada antes da chamada com o modelo, os tokens e o `cost_usd` SNAPSHOT
 * (#463: preço de hoje gravado; `null` honesto sem telemetria ou com modelo fora da tabela).
 */
export async function recordMenuSuggestionUsage(input: {
  db: Database
  eventId: string
  model: string
  usage: TextUsage | undefined
}): Promise<void> {
  const { db, eventId, model, usage } = input
  const cost = computeTextCost(usage, model)
  await db
    .update(mealPlanSuggestionEvent)
    .set({
      model,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
      costUsd: cost != null ? cost.toFixed(6) : null,
    })
    .where(eq(mealPlanSuggestionEvent.id, eventId))
}

// ── Aceite ───────────────────────────────────────────────────────────────────────

export type MenuApplyResult = { addedCount: number; skippedCount: number }

/**
 * Aceita (parte de) uma sugestão: grava cada entrada como Refeição planejada, re-validando tudo — o gate
 * de Salvar (inelegível ⇒ pula), o teto por dia (cheio ⇒ pula) e a UNIQUE (a mesma Receita já planejada
 * naquele dia × refeição ⇒ pula, SEM mexer nas porções que o Usuário ajustou; ≠ `applyAddMealPlanEntry`,
 * que é upsert). Uma transação: um erro no meio não deixa meia semana gravada.
 */
export async function applyMenuSuggestionEntries(input: {
  db: Database
  userId: string
  entries: readonly MenuApplyEntry[]
}): Promise<MenuApplyResult> {
  const { db, userId, entries } = input
  const ids = [...new Set(entries.map((e) => e.recipeId))]
  const gates = await db.select({ id: recipe.id, gate: GATE_COLS }).from(recipe).where(inArray(recipe.id, ids))
  const eligible = new Set(gates.filter((g) => eligibleToSaveByViewer(g.gate, userId)).map((g) => g.id))

  return db.transaction(async (tx) => {
    // Contagem por dia UMA vez (≤ 7 dias), incrementada a cada INSERT — não uma contagem por entrada.
    const days = [...new Set(entries.map((e) => e.day))]
    const perDay = new Map<string, number>()
    for (const day of days) perDay.set(day, await countEntriesOnDay(tx, userId, day))
    let addedCount = 0
    for (const e of entries) {
      if (!eligible.has(e.recipeId)) continue
      const onDay = perDay.get(e.day) ?? 0
      if (onDay >= MAX_MEAL_PLAN_ENTRIES_PER_DAY) continue
      const inserted = await tx
        .insert(mealPlanEntry)
        .values({ userId, day: e.day, slot: e.slot, recipeId: e.recipeId, porcoes: e.porcoes })
        .onConflictDoNothing({
          target: [mealPlanEntry.userId, mealPlanEntry.day, mealPlanEntry.slot, mealPlanEntry.recipeId],
        })
        .returning({ id: mealPlanEntry.id })
      if (inserted.length > 0) {
        addedCount++
        perDay.set(e.day, onDay + 1)
      }
    }
    return { addedCount, skippedCount: entries.length - addedCount }
  })
}
