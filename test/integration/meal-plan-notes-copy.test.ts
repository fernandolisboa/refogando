import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { mealPlanEntry, recipe, shoppingList } from '@/db/schema'
import { MAX_MEAL_PLAN_ENTRIES_PER_DAY, MEAL_PLAN_NOTE_MAX, type MealSlot } from '@/domain/meal-plan'
import { menuTargets } from '@/domain/menu-suggestion'
import { loadPlannedSlots } from '@/server/meal-plan/menu-suggestion'
import { GET as planGetRoute } from '@/app/api/me/meal-plan/route'
import { POST as entriesPostRoute } from '@/app/api/me/meal-plan/entries/route'
import { PATCH as entryPatchRoute } from '@/app/api/me/meal-plan/entries/[entryId]/route'
import { POST as toShoppingListRoute } from '@/app/api/me/meal-plan/shopping-list/route'
import { POST as copyRoute } from '@/app/api/me/meal-plan/copy-previous-week/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedRemovedFromPool } from '../helpers/recipes'

/**
 * ADR-0037 pela porta alta (route handlers): Anotação livre no Cardápio ("jantar fora") e "Copiar
 * semana anterior". Inegociáveis: a Anotação ocupa a refeição (teto por dia, Sugestão não planeja por
 * cima) mas não tem porções nem vai pra Lista; a cópia só preenche refeições vazias, re-aplica o gate
 * de Salvar e NUNCA lê o plano de outro usuário; duplo clique não duplica.
 */

function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}
const addEntry = (body: Record<string, unknown>, headers?: Headers) =>
  entriesPostRoute(jsonReq('/api/me/meal-plan/entries', 'POST', headers, body))
const patchEntry = (entryId: string, body: Record<string, unknown>, headers?: Headers) =>
  entryPatchRoute(jsonReq(`/api/me/meal-plan/entries/${entryId}`, 'PATCH', headers, body), {
    params: Promise.resolve({ entryId }),
  })
const planToList = (body: Record<string, unknown>, headers?: Headers) =>
  toShoppingListRoute(jsonReq('/api/me/meal-plan/shopping-list', 'POST', headers, body))
const copyWeek = (body: Record<string, unknown>, headers?: Headers) =>
  copyRoute(jsonReq('/api/me/meal-plan/copy-previous-week', 'POST', headers, body))

type EntryView = {
  id: string
  day: string
  slot: MealSlot
  porcoes: number | null
  note: string | null
  recipe: { id: string; name: string } | null
}

let seq = 0
const session = () => seedSessionHeaders({ email: `mpn-${seq++}-${crypto.randomUUID()}@ex.com` })

async function seedCatalogRecipe(titulo: string, ingredient?: string): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, porcoes: 2 })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  if (ingredient) {
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: ingredient, quantidade: '100', unidade: 'g' as never })
  }
  return recipeId
}

async function readWeek(headers: Headers, from: string, to: string): Promise<EntryView[]> {
  const res = await planGetRoute(jsonReq(`/api/me/meal-plan?from=${from}&to=${to}`, 'GET', headers))
  expect(res.status).toBe(200)
  return ((await res.json()) as { entries: EntryView[] }).entries
}

async function note(headers: Headers, text: string, day: string, slot: MealSlot): Promise<string> {
  const res = await addEntry({ note: text, day, slot }, headers)
  expect(res.status).toBe(200)
  return ((await res.json()) as { entryId: string }).entryId
}

async function plan(headers: Headers, recipeId: string, day: string, slot: MealSlot, porcoes?: number) {
  const res = await addEntry({ recipeId, day, slot, ...(porcoes ? { porcoes } : {}) }, headers)
  expect(res.status).toBe(200)
}

const PREV_MON = '2026-09-21'
const PREV_WED = '2026-09-23'
const MON = '2026-09-28'
const WED = '2026-09-30'
const THU = '2026-10-01'
const SUN = '2026-10-04'

// ── Anotação ─────────────────────────────────────────────────────────────────────
describe('Cardápio — Anotação livre (ADR-0037)', () => {
  it('anota (normalizada), o GET devolve com note e sem Receita, na ordem do dia com as Receitas', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe('Feijoada')
    await plan(headers, r, WED, 'jantar')
    const id = await note(headers, '  Jantar   fora ', WED, 'almoco')

    const week = await readWeek(headers, MON, SUN)
    expect(week.map((e) => [e.slot, e.note, e.recipe?.name ?? null])).toEqual([
      ['almoco', 'Jantar fora', null],
      ['jantar', null, 'Feijoada'],
    ])
    expect(week[0]).toMatchObject({ id, day: WED, porcoes: null })
  })

  it('a MESMA anotação na mesma refeição é idempotente (mesma entrada); noutra refeição é outra', async () => {
    const { headers } = await session()
    const a = await note(headers, 'Sobras', WED, 'jantar')
    const b = await note(headers, 'Sobras', WED, 'jantar')
    const c = await note(headers, 'Sobras', THU, 'jantar')
    expect(b).toBe(a)
    expect(c).not.toBe(a)
    expect(await readWeek(headers, MON, SUN)).toHaveLength(2)
  })

  it('400 dados_invalidos: vazia, longa demais, junto de recipeId ou de porções, dia/refeição ruins', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe('X')
    const bad = [
      { note: '   ', day: WED, slot: 'jantar' },
      { note: 'x'.repeat(MEAL_PLAN_NOTE_MAX + 1), day: WED, slot: 'jantar' },
      { note: 'Fora', recipeId: r, day: WED, slot: 'jantar' },
      { note: 'Fora', porcoes: 2, day: WED, slot: 'jantar' },
      { note: 'Fora', day: '2026-02-30', slot: 'jantar' },
      { note: 'Fora', day: WED, slot: 'ceia' },
      { note: 42, day: WED, slot: 'jantar' },
    ]
    for (const body of bad) {
      const res = await addEntry(body, headers)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(await res.json()).toEqual({ error: 'dados_invalidos' })
    }
    expect(await getDb().select().from(mealPlanEntry)).toHaveLength(0)
  })

  it('Visitante ⇒ 401 ao anotar e ao copiar', async () => {
    expect((await addEntry({ note: 'Fora', day: WED, slot: 'jantar' })).status).toBe(401)
    expect((await copyWeek({ week: MON })).status).toBe(401)
  })

  it('conta no teto por dia (422 dia_cheio)', async () => {
    const { headers } = await session()
    for (let i = 0; i < MAX_MEAL_PLAN_ENTRIES_PER_DAY; i++) await note(headers, `Nota ${i}`, WED, 'lanche')
    const res = await addEntry({ note: 'Mais uma', day: WED, slot: 'lanche' }, headers)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'dia_cheio' })
  })

  it('PATCH: mover funciona; porções numa anotação ⇒ 400 (null é inofensivo); mover sobre a mesma anotação ⇒ 409', async () => {
    const { headers } = await session()
    const a = await note(headers, 'Fora', WED, 'jantar')
    await note(headers, 'Fora', THU, 'jantar')

    expect((await patchEntry(a, { porcoes: 2 }, headers)).status).toBe(400)
    expect((await patchEntry(a, { porcoes: null }, headers)).status).toBe(200)
    expect((await patchEntry(a, { slot: 'almoco' }, headers)).status).toBe(200)
    const moved = await patchEntry(a, { day: THU, slot: 'jantar' }, headers)
    expect(moved.status).toBe(409)
    expect(await moved.json()).toEqual({ error: 'ja_planejada' })

    const week = await readWeek(headers, MON, SUN)
    expect(week.find((e) => e.id === a)).toMatchObject({ day: WED, slot: 'almoco', note: 'Fora' })
  })

  it('anotação de outro usuário: invisível no GET e 404 no PATCH', async () => {
    const owner = await session()
    const intruder = await session()
    const id = await note(owner.headers, 'Segredo', WED, 'jantar')
    expect(await readWeek(intruder.headers, MON, SUN)).toEqual([])
    expect((await patchEntry(id, { slot: 'almoco' }, intruder.headers)).status).toBe(404)
  })

  it('"Gerar lista" ignora anotações: semana só com anotações ⇒ plano_vazio, sem lista nova', async () => {
    const { headers } = await session()
    await note(headers, 'Fora', WED, 'jantar')
    const res = await planToList({ from: MON, to: SUN, newListName: 'Semana' }, headers)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'plano_vazio' })
    expect(await getDb().select().from(shoppingList)).toHaveLength(0)
  })

  it('"Gerar lista" com Receita + anotação: só a Receita entra', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe('Arroz', 'arroz')
    await plan(headers, r, WED, 'almoco')
    await note(headers, 'Fora', WED, 'jantar')
    const res = await planToList({ from: MON, to: SUN, newListName: 'Semana' }, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ addedCount: 1, skippedCount: 0 })
  })

  it('Sugestão: a anotação preenche a refeição (onlyEmpty não a oferece à IA)', async () => {
    const { headers, userId } = await session()
    await note(headers, 'Jantar fora', WED, 'jantar')
    const planned = await loadPlannedSlots({ db: getDb(), userId, range: { from: MON, to: SUN } })
    expect(planned).toEqual([{ day: WED, slot: 'jantar', recipeId: null }])
    const targets = menuTargets({ days: [WED], slots: ['almoco', 'jantar'], onlyEmpty: true }, planned)
    expect(targets).toEqual([{ day: WED, slot: 'almoco' }])
  })

  it('o banco barra linha sem Receita nem anotação, e com as duas', async () => {
    const { userId } = await session()
    const r = await seedCatalogRecipe('X')
    await expect(getDb().insert(mealPlanEntry).values({ userId, day: WED, slot: 'jantar' })).rejects.toThrow()
    await expect(
      getDb().insert(mealPlanEntry).values({ userId, day: WED, slot: 'jantar', recipeId: r, note: 'x' }),
    ).rejects.toThrow()
  })
})

// ── Copiar semana anterior ───────────────────────────────────────────────────────
describe('Cardápio — copiar semana anterior (ADR-0037)', () => {
  it('copia Receitas (com porções) e anotações pra mesma refeição da semana seguinte', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe('Feijoada')
    await plan(headers, r, PREV_MON, 'almoco', 5)
    await note(headers, 'Pizza', PREV_WED, 'jantar')

    const res = await copyWeek({ week: MON }, headers)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, addedCount: 2, skippedCount: 0 })

    const week = await readWeek(headers, MON, SUN)
    expect(week.map((e) => [e.day, e.slot, e.recipe?.id ?? e.note, e.porcoes])).toEqual([
      [MON, 'almoco', r, 5],
      [WED, 'jantar', 'Pizza', null],
    ])
    // A origem fica intacta.
    expect(await readWeek(headers, PREV_MON, '2026-09-27')).toHaveLength(2)
  })

  it('só preenche refeições vazias; duplo clique não duplica', async () => {
    const { headers } = await session()
    const a = await seedCatalogRecipe('A')
    const b = await seedCatalogRecipe('B')
    await plan(headers, a, PREV_MON, 'almoco')
    await plan(headers, a, PREV_MON, 'jantar')
    await plan(headers, b, MON, 'jantar') // jantar de segunda já planejado

    const first = await copyWeek({ week: MON }, headers)
    expect(await first.json()).toEqual({ ok: true, addedCount: 1, skippedCount: 1 })
    const again = await copyWeek({ week: MON }, headers)
    expect(await again.json()).toEqual({ ok: true, addedCount: 0, skippedCount: 2 })

    const week = await readWeek(headers, MON, SUN)
    expect(week.map((e) => [e.slot, e.recipe?.id])).toEqual([
      ['almoco', a],
      ['jantar', b],
    ])
  })

  it('fromDay: na semana corrente não preenche os dias que já passaram', async () => {
    const { headers } = await session()
    const a = await seedCatalogRecipe('A')
    await plan(headers, a, PREV_MON, 'almoco')
    await plan(headers, a, '2026-09-24', 'almoco') // quinta anterior

    const res = await copyWeek({ week: MON, fromDay: WED }, headers)
    expect(await res.json()).toEqual({ ok: true, addedCount: 1, skippedCount: 0 })
    expect((await readWeek(headers, MON, SUN)).map((e) => e.day)).toEqual([THU])
  })

  it('Receita que ficou inelegível na semana passada não é copiada (conta como pulada)', async () => {
    const { headers } = await session()
    const curator = await session()
    const ok = await seedCatalogRecipe('Boa')
    const gone = await seedCatalogRecipe('Removida')
    await plan(headers, ok, PREV_MON, 'almoco')
    await plan(headers, gone, PREV_MON, 'jantar')
    await seedRemovedFromPool({ recipeId: gone, curatorId: curator.userId })

    const res = await copyWeek({ week: MON }, headers)
    expect(await res.json()).toEqual({ ok: true, addedCount: 1, skippedCount: 1 })
    const rows = await getDb()
      .select()
      .from(mealPlanEntry)
      .where(and(eq(mealPlanEntry.day, MON), eq(mealPlanEntry.recipeId, gone)))
    expect(rows).toHaveLength(0)
  })

  it('Receita privada que o dono tornou privada depois não é copiada pra outro usuário', async () => {
    const author = await session()
    const planner = await session()
    const [row] = await getDb()
      .insert(recipe)
      .values({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'public', ownerId: author.userId })
      .returning({ id: recipe.id })
    await seedTranslation({ recipeId: row.id, locale: 'pt-BR', titulo: 'Pública', provenance: 'escrita_por_pessoa' })
    await plan(planner.headers, row.id, PREV_MON, 'almoco')
    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, row.id))

    const res = await copyWeek({ week: MON }, planner.headers)
    expect(await res.json()).toEqual({ ok: true, addedCount: 0, skippedCount: 1 })
  })

  it('nunca copia o plano de outro usuário: semana anterior vazia pra quem pede ⇒ 422', async () => {
    const owner = await session()
    const other = await session()
    await note(owner.headers, 'Fora', PREV_MON, 'jantar')
    const res = await copyWeek({ week: MON }, other.headers)
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'semana_anterior_vazia' })
    expect(await readWeek(other.headers, MON, SUN)).toEqual([])
  })

  it('400 dados_invalidos: week que não é segunda, fora da janela, fromDay fora da semana', async () => {
    const { headers } = await session()
    for (const body of [
      {},
      { week: WED },
      { week: '2026-13-01' },
      { week: '2019-12-30' }, // a semana anterior cairia antes da janela
      { week: MON, fromDay: '2026-10-05' },
      { week: MON, fromDay: '2026-09-27' },
      { week: MON, fromDay: 'hoje' },
    ]) {
      const res = await copyWeek(body, headers)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
  })
})
