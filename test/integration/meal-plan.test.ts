import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { mealPlanEntry, recipe, shoppingList } from '@/db/schema'
import { MAX_MEAL_PLAN_ENTRIES_PER_DAY, type MealSlot } from '@/domain/meal-plan'
import { MAX_SHOPPING_LISTS_PER_USER } from '@/domain/shopping-list'
import { GET as planGetRoute } from '@/app/api/me/meal-plan/route'
import { POST as entriesPostRoute } from '@/app/api/me/meal-plan/entries/route'
import {
  PATCH as entryPatchRoute,
  DELETE as entryDeleteRoute,
} from '@/app/api/me/meal-plan/entries/[entryId]/route'
import { POST as toShoppingListRoute } from '@/app/api/me/meal-plan/shopping-list/route'
import { GET as itemsGetRoute } from '@/app/api/me/shopping-lists/[listId]/items/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient, seedRemovedFromPool } from '../helpers/recipes'

/**
 * Plano de refeições (ADR-0035) pela porta mais alta (route handlers), no modelo de invocação de
 * `shopping-list-add.test.ts`. `setup.ts` aponta o DI pro Postgres descartável e trunca antes de
 * cada teste. Inegociáveis: privacidade por construção (visitante 401; plano/entrada/lista de
 * outro ⇒ 404 leak-safe, nunca aparece no GET), gate da Receita = o de Salvar ao PLANEJAR e ao
 * LER (inelegível depois ⇒ `recipe: null`), upsert idempotente, teto por dia, e o "gerar lista"
 * que escala CADA entrada pelas SUAS porções e agrega no mesmo núcleo do ADR-0032.
 */

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function getPlan(from: unknown, to: unknown, headers?: Headers): Promise<Response> {
  const q = new URLSearchParams()
  if (typeof from === 'string') q.set('from', from)
  if (typeof to === 'string') q.set('to', to)
  return planGetRoute(jsonReq(`/api/me/meal-plan?${q.toString()}`, 'GET', headers))
}

function addEntry(body: Record<string, unknown>, headers?: Headers): Promise<Response> {
  return entriesPostRoute(jsonReq('/api/me/meal-plan/entries', 'POST', headers, body))
}

function patchEntry(entryId: string, body: Record<string, unknown>, headers?: Headers): Promise<Response> {
  return entryPatchRoute(jsonReq(`/api/me/meal-plan/entries/${entryId}`, 'PATCH', headers, body), {
    params: Promise.resolve({ entryId }),
  })
}

function deleteEntry(entryId: string, headers?: Headers): Promise<Response> {
  return entryDeleteRoute(jsonReq(`/api/me/meal-plan/entries/${entryId}`, 'DELETE', headers), {
    params: Promise.resolve({ entryId }),
  })
}

function planToList(body: Record<string, unknown>, headers?: Headers): Promise<Response> {
  return toShoppingListRoute(jsonReq('/api/me/meal-plan/shopping-list', 'POST', headers, body))
}

function getItems(listId: string, headers?: Headers): Promise<Response> {
  return itemsGetRoute(jsonReq(`/api/me/shopping-lists/${listId}/items`, 'GET', headers), {
    params: Promise.resolve({ listId }),
  })
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session() {
  return seedSessionHeaders({ email: `mp-${seq++}-${crypto.randomUUID()}@ex.com` })
}
async function seedList(userId: string, name = 'Lista'): Promise<string> {
  const [row] = await getDb().insert(shoppingList).values({ userId, name }).returning({ id: shoppingList.id })
  return row.id
}

async function seedCatalogRecipe(
  opts: {
    titulo?: string
    porcoes?: number | null
    ingredients?: { rawText: string; quantidade?: string | null; unidade?: string | null }[]
  } = {},
): Promise<string> {
  const recipeId = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    porcoes: opts.porcoes ?? null,
  })
  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: opts.titulo ?? 'Receita de teste',
    provenance: 'escrita_por_pessoa',
  })
  let ordem = 0
  for (const ing of opts.ingredients ?? []) {
    await seedRecipeIngredient({
      recipeId,
      ordem: ordem++,
      rawText: ing.rawText,
      quantidade: ing.quantidade ?? null,
      unidade: (ing.unidade ?? null) as never,
    })
  }
  return recipeId
}

async function seedUserRecipe(ownerId: string, visibility: 'public' | 'private', titulo: string): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility, ownerId })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return recipeId
}

type EntryView = {
  id: string
  day: string
  slot: MealSlot
  porcoes: number | null
  createdAt: string
  recipe: { id: string; name: string; porcoes: number | null; slug?: string } | null
}
type PlanBody = { entries: EntryView[] }
type AddBody = { ok: true; entryId: string }
type ItemView = { nome: string; quantidade: string | null; unidade: string | null }
type ItemsBody = { items: ItemView[] }
type ToListBody = {
  ok: true
  list: { id: string; name: string }
  addedCount: number
  skippedCount: number
  semPorcoesCount: number
}

const MON = '2026-09-28'
const TUE = '2026-09-29'
const WED = '2026-09-30'
const SUN = '2026-10-04'

async function plan(
  headers: Headers,
  recipeId: string,
  day: string,
  slot: MealSlot,
  porcoes?: number | null,
): Promise<string> {
  const res = await addEntry({ recipeId, day, slot, ...(porcoes !== undefined ? { porcoes } : {}) }, headers)
  expect(res.status).toBe(200)
  return ((await res.json()) as AddBody).entryId
}

async function readWeek(headers: Headers, from = MON, to = SUN): Promise<EntryView[]> {
  const res = await getPlan(from, to, headers)
  expect(res.status).toBe(200)
  return ((await res.json()) as PlanBody).entries
}

// ── Acesso ──────────────────────────────────────────────────────────────────────
describe('Plano de refeições — acesso (ADR-0035)', () => {
  it('Visitante ⇒ 401 em TODAS as rotas (zero efeito)', async () => {
    const someId = crypto.randomUUID()
    expect((await getPlan(MON, SUN)).status).toBe(401)
    expect((await addEntry({ recipeId: someId, day: MON, slot: 'almoco' })).status).toBe(401)
    expect((await patchEntry(someId, { porcoes: 2 })).status).toBe(401)
    expect((await deleteEntry(someId)).status).toBe(401)
    expect((await planToList({ from: MON, to: SUN, listId: someId })).status).toBe(401)
    expect(await getDb().select().from(mealPlanEntry)).toHaveLength(0)
  })
})

// ── Planejar + ler ──────────────────────────────────────────────────────────────
describe('Plano de refeições — planejar e ler a semana', () => {
  it('planeja uma Receita do catálogo e o GET a devolve com o card (nome, porções da Receita)', async () => {
    const { headers } = await session()
    const recipeId = await seedCatalogRecipe({ titulo: 'Feijoada', porcoes: 6 })

    const res = await addEntry({ recipeId, day: TUE, slot: 'almoco', porcoes: 4 }, headers)
    expect(res.status).toBe(200)
    const { entryId } = (await res.json()) as AddBody

    const getRes = await getPlan(MON, SUN, headers)
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get('cache-control')).toBe('no-store')
    const { entries } = (await getRes.json()) as PlanBody
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      id: entryId,
      day: TUE,
      slot: 'almoco',
      porcoes: 4,
      recipe: { id: recipeId, name: 'Feijoada', porcoes: 6 },
    })
  })

  it('GET ordena por dia → refeição do dia (não pela ordem de criação)', async () => {
    const { headers } = await session()
    const a = await seedCatalogRecipe({ titulo: 'A' })
    const b = await seedCatalogRecipe({ titulo: 'B' })

    await plan(headers, a, WED, 'cafe_da_manha')
    await plan(headers, a, TUE, 'jantar')
    await plan(headers, b, TUE, 'cafe_da_manha')
    await plan(headers, b, TUE, 'almoco')
    await plan(headers, a, TUE, 'lanche')

    const entries = await readWeek(headers)
    expect(entries.map((e) => [e.day, e.slot])).toEqual([
      [TUE, 'cafe_da_manha'],
      [TUE, 'almoco'],
      [TUE, 'lanche'],
      [TUE, 'jantar'],
      [WED, 'cafe_da_manha'],
    ])
  })

  it('GET é inclusivo nas duas pontas e não traz dias fora do intervalo', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe()
    await plan(headers, r, MON, 'almoco')
    await plan(headers, r, SUN, 'almoco')
    await plan(headers, r, '2026-10-05', 'almoco')
    await plan(headers, r, '2026-09-27', 'almoco')

    expect((await readWeek(headers)).map((e) => e.day)).toEqual([MON, SUN])
  })

  it('re-planejar a MESMA Receita no MESMO dia+refeição atualiza as porções (idempotente, uma entrada)', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe({ porcoes: 4 })

    const first = await plan(headers, r, MON, 'jantar', 2)
    const second = await plan(headers, r, MON, 'jantar', 6)
    expect(second).toBe(first)

    const entries = await readWeek(headers)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: first, porcoes: 6 })

    // Sem porções ⇒ MANTÉM as já escolhidas (coalesce): planejar de novo de um lugar sem escalador
    // não apaga o ajuste. Ainda uma entrada só.
    await plan(headers, r, MON, 'jantar')
    const again = await readWeek(headers)
    expect(again).toHaveLength(1)
    expect(again[0].porcoes).toBe(6)
  })

  it('a mesma Receita em refeições/dias diferentes são entradas distintas', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe()
    await plan(headers, r, MON, 'almoco')
    await plan(headers, r, MON, 'jantar')
    await plan(headers, r, TUE, 'almoco')
    expect(await readWeek(headers)).toHaveLength(3)
  })

  it('Receita PRIVADA de outro usuário ⇒ 404 leak-safe (nada gravado); inexistente ⇒ 404', async () => {
    const { headers } = await session()
    const owner = await session()
    const privada = await seedUserRecipe(owner.userId, 'private', 'Segredo')

    const res = await addEntry({ recipeId: privada, day: MON, slot: 'almoco' }, headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
    expect((await addEntry({ recipeId: crypto.randomUUID(), day: MON, slot: 'almoco' }, headers)).status).toBe(404)
    expect((await addEntry({ recipeId: 'nao-uuid', day: MON, slot: 'almoco' }, headers)).status).toBe(404)
    expect(await getDb().select().from(mealPlanEntry)).toHaveLength(0)
  })

  it('a PRÓPRIA Receita privada pode ser planejada e aparece com o título', async () => {
    const { userId, headers } = await session()
    const minha = await seedUserRecipe(userId, 'private', 'Minha receita')

    await plan(headers, minha, MON, 'almoco')
    const entries = await readWeek(headers)
    expect(entries[0].recipe).toMatchObject({ id: minha, name: 'Minha receita' })
  })

  it('Receita PÚBLICA de outro usuário pode ser planejada', async () => {
    const { headers } = await session()
    const owner = await session()
    const publica = await seedUserRecipe(owner.userId, 'public', 'Pública')
    await plan(headers, publica, MON, 'almoco')
    expect((await readWeek(headers))[0].recipe).toMatchObject({ id: publica, name: 'Pública' })
  })

  it(`teto de ${MAX_MEAL_PLAN_ENTRIES_PER_DAY} refeições por dia ⇒ 422 dia_cheio; upsert de uma existente segue ok`, async () => {
    const { headers } = await session()
    const slots: MealSlot[] = ['cafe_da_manha', 'almoco', 'lanche', 'jantar']
    const recipes: string[] = []
    for (let i = 0; i <= MAX_MEAL_PLAN_ENTRIES_PER_DAY; i++) recipes.push(await seedCatalogRecipe())

    for (let i = 0; i < MAX_MEAL_PLAN_ENTRIES_PER_DAY; i++) {
      await plan(headers, recipes[i], MON, slots[i % slots.length])
    }
    const res = await addEntry({ recipeId: recipes[MAX_MEAL_PLAN_ENTRIES_PER_DAY], day: MON, slot: 'jantar' }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'dia_cheio' })

    // Re-planejar uma que JÁ está no dia é upsert: não conta no teto.
    await plan(headers, recipes[0], MON, 'cafe_da_manha', 3)
    // Outro dia não é afetado.
    await plan(headers, recipes[MAX_MEAL_PLAN_ENTRIES_PER_DAY], TUE, 'jantar')

    const entries = await readWeek(headers)
    expect(entries.filter((e) => e.day === MON)).toHaveLength(MAX_MEAL_PLAN_ENTRIES_PER_DAY)
    expect(entries.filter((e) => e.day === TUE)).toHaveLength(1)
  })

  it('dia/refeição/porções malformados ⇒ 400 dados_invalidos', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe()
    const bad: Record<string, unknown>[] = [
      { recipeId: r, day: '2026-02-30', slot: 'almoco' },
      { recipeId: r, day: '28/09/2026', slot: 'almoco' },
      { recipeId: r, slot: 'almoco' },
      { recipeId: r, day: MON, slot: 'ceia' },
      { recipeId: r, day: MON },
      { recipeId: r, day: MON, slot: 'almoco', porcoes: 0 },
      { recipeId: r, day: MON, slot: 'almoco', porcoes: 100 },
      { recipeId: r, day: MON, slot: 'almoco', porcoes: 1.5 },
      { recipeId: r, day: MON, slot: 'almoco', porcoes: '2' },
    ]
    for (const body of bad) {
      const res = await addEntry(body, headers)
      expect(res.status, JSON.stringify(body)).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    }
    expect(await getDb().select().from(mealPlanEntry)).toHaveLength(0)
  })

  it('GET com intervalo inválido ⇒ 400 intervalo_invalido', async () => {
    const { headers } = await session()
    const cases: [unknown, unknown][] = [
      [undefined, undefined],
      [MON, undefined],
      ['2026-02-30', SUN],
      [SUN, MON], // from > to
      [MON, '2026-10-12'], // 15 dias
    ]
    for (const [from, to] of cases) {
      const res = await getPlan(from, to, headers)
      expect(res.status, `${String(from)}..${String(to)}`).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'intervalo_invalido' })
    }
    // 14 dias inclusivos ainda passa.
    expect((await getPlan(MON, '2026-10-11', headers)).status).toBe(200)
  })
})

// ── Privacidade entre usuários ─────────────────────────────────────────────────
describe('Plano de refeições — privado por usuário', () => {
  it('entrada de OUTRO usuário: PATCH/DELETE ⇒ 404 e o GET do outro nunca a mostra', async () => {
    const a = await session()
    const b = await session()
    const r = await seedCatalogRecipe()
    const entryA = await plan(a.headers, r, MON, 'almoco', 2)

    expect((await patchEntry(entryA, { porcoes: 5 }, b.headers)).status).toBe(404)
    expect((await deleteEntry(entryA, b.headers)).status).toBe(404)
    expect(await readWeek(b.headers)).toEqual([])

    // Intacta para A.
    const entries = await readWeek(a.headers)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: entryA, porcoes: 2 })
  })

  it('uuid malformado / inexistente ⇒ 404', async () => {
    const { headers } = await session()
    expect((await patchEntry('nao-uuid', { porcoes: 2 }, headers)).status).toBe(404)
    expect((await deleteEntry('nao-uuid', headers)).status).toBe(404)
    expect((await patchEntry(crypto.randomUUID(), { porcoes: 2 }, headers)).status).toBe(404)
    expect((await deleteEntry(crypto.randomUUID(), headers)).status).toBe(404)
  })
})

// ── Mover / ajustar / tirar ─────────────────────────────────────────────────────
describe('Plano de refeições — PATCH e DELETE', () => {
  it('PATCH move dia/refeição e ajusta porções; porcoes: null volta às da Receita', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe({ porcoes: 4 })
    const id = await plan(headers, r, MON, 'almoco')

    const moved = await patchEntry(id, { day: WED, slot: 'jantar', porcoes: 3 }, headers)
    expect(moved.status).toBe(200)
    await expect(moved.json()).resolves.toEqual({ ok: true })
    let [e] = await readWeek(headers)
    expect(e).toMatchObject({ id, day: WED, slot: 'jantar', porcoes: 3 })

    // Só o slot: dia e porções ficam.
    expect((await patchEntry(id, { slot: 'lanche' }, headers)).status).toBe(200)
    ;[e] = await readWeek(headers)
    expect(e).toMatchObject({ day: WED, slot: 'lanche', porcoes: 3 })

    // porcoes: null ⇒ volta às porções da Receita.
    expect((await patchEntry(id, { porcoes: null }, headers)).status).toBe(200)
    ;[e] = await readWeek(headers)
    expect(e).toMatchObject({ day: WED, slot: 'lanche', porcoes: null })
  })

  it('PATCH com corpo vazio ou campo malformado ⇒ 400 (nada muda)', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe()
    const id = await plan(headers, r, MON, 'almoco', 2)

    for (const body of [{}, { day: '2026-02-30' }, { slot: 'ceia' }, { porcoes: 0 }, { porcoes: '3' }, { day: null }]) {
      const res = await patchEntry(id, body, headers)
      expect(res.status, JSON.stringify(body)).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    }
    expect((await readWeek(headers))[0]).toMatchObject({ day: MON, slot: 'almoco', porcoes: 2 })
  })

  it('PATCH pra onde a MESMA Receita já está planejada ⇒ 409 ja_planejada (sem fundir)', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe()
    const almoco = await plan(headers, r, MON, 'almoco', 2)
    await plan(headers, r, MON, 'jantar', 4)
    const terca = await plan(headers, r, TUE, 'jantar')

    const res = await patchEntry(almoco, { slot: 'jantar' }, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'ja_planejada' })

    expect((await patchEntry(terca, { day: MON }, headers)).status).toBe(409)

    const entries = await readWeek(headers)
    expect(entries).toHaveLength(3)
    expect(entries.find((e) => e.id === almoco)).toMatchObject({ day: MON, slot: 'almoco', porcoes: 2 })
  })

  it('PATCH movendo pra um dia CHEIO ⇒ 422 dia_cheio; mudar só o slot dentro do dia cheio segue ok', async () => {
    const { headers } = await session()
    const recipes: string[] = []
    for (let i = 0; i <= MAX_MEAL_PLAN_ENTRIES_PER_DAY; i++) recipes.push(await seedCatalogRecipe())
    const ids: string[] = []
    for (let i = 0; i < MAX_MEAL_PLAN_ENTRIES_PER_DAY; i++) ids.push(await plan(headers, recipes[i], MON, 'almoco'))
    const outro = await plan(headers, recipes[MAX_MEAL_PLAN_ENTRIES_PER_DAY], TUE, 'almoco')

    const res = await patchEntry(outro, { day: MON }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'dia_cheio' })

    expect((await patchEntry(ids[0], { slot: 'jantar' }, headers)).status).toBe(200)
    expect((await patchEntry(ids[0], { day: MON, porcoes: 2 }, headers)).status).toBe(200)
  })

  it('DELETE tira a entrada do plano; um segundo DELETE ⇒ 404', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe()
    const id = await plan(headers, r, MON, 'almoco')
    const keep = await plan(headers, r, TUE, 'almoco')

    const res = await deleteEntry(id, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect((await deleteEntry(id, headers)).status).toBe(404)
    expect((await readWeek(headers)).map((e) => e.id)).toEqual([keep])
  })
})

// ── Receita que muda depois de planejada ────────────────────────────────────────
describe('Plano de refeições — a Receita planejada é VIVA', () => {
  it('Receita que fica inelegível depois (dono a torna privada) segue no plano com recipe: null', async () => {
    const { headers } = await session()
    const owner = await session()
    const publica = await seedUserRecipe(owner.userId, 'public', 'Título que não pode vazar')
    const catalogo = await seedCatalogRecipe({ titulo: 'Arroz' })
    const id = await plan(headers, publica, MON, 'almoco', 2)
    await plan(headers, catalogo, MON, 'almoco')

    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, publica))

    const res = await getPlan(MON, SUN, headers)
    const raw = await res.text()
    expect(raw).not.toContain('Título que não pode vazar')
    const { entries } = JSON.parse(raw) as PlanBody
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.id === id)).toMatchObject({ day: MON, slot: 'almoco', porcoes: 2, recipe: null })
    expect(entries.find((e) => e.id !== id)?.recipe).toMatchObject({ id: catalogo, name: 'Arroz' })

    // O dono do plano ainda pode tirá-la.
    expect((await deleteEntry(id, headers)).status).toBe(200)

    // E não consegue planejá-la de novo (gate de Salvar).
    expect((await addEntry({ recipeId: publica, day: TUE, slot: 'almoco' }, headers)).status).toBe(404)
  })

  it('Receita removida por moderação também vira recipe: null', async () => {
    const { headers } = await session()
    const curator = await session()
    const r = await seedCatalogRecipe({ titulo: 'Moderada' })
    await plan(headers, r, MON, 'almoco')
    await seedRemovedFromPool({ recipeId: r, curatorId: curator.userId })
    expect((await readWeek(headers))[0].recipe).toBeNull()
  })

  it('apagar a Receita apaga a entrada do plano junto (ON DELETE cascade)', async () => {
    const { userId, headers } = await session()
    const minha = await seedUserRecipe(userId, 'private', 'Vai sumir')
    const outra = await seedCatalogRecipe()
    await plan(headers, minha, MON, 'almoco')
    const keep = await plan(headers, outra, MON, 'jantar')

    await getDb().delete(recipe).where(eq(recipe.id, minha))

    expect((await readWeek(headers)).map((e) => e.id)).toEqual([keep])
    expect(await getDb().select().from(mealPlanEntry).where(eq(mealPlanEntry.recipeId, minha))).toHaveLength(0)
  })
})

// ── Plano → Lista de compras ────────────────────────────────────────────────────
describe('Plano de refeições → Lista de compras (dec.5)', () => {
  it('Lista de OUTRO usuário ⇒ 404 leak-safe (nada entra nela)', async () => {
    const a = await session()
    const b = await session()
    const listB = await seedList(b.userId)
    const r = await seedCatalogRecipe({ ingredients: [{ rawText: 'Sal', quantidade: '1', unidade: 'g' }] })
    await plan(a.headers, r, MON, 'almoco')

    const res = await planToList({ from: MON, to: SUN, listId: listB }, a.headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
    expect(((await (await getItems(listB, b.headers)).json()) as ItemsBody).items).toEqual([])

    // uuid malformado / inexistente também 404.
    expect((await planToList({ from: MON, to: SUN, listId: 'x' }, a.headers)).status).toBe(404)
    expect((await planToList({ from: MON, to: SUN, listId: crypto.randomUUID() }, a.headers)).status).toBe(404)
  })

  it('intervalo sem nenhuma refeição ⇒ 422 plano_vazio; intervalo inválido ⇒ 400', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const r = await seedCatalogRecipe({ ingredients: [{ rawText: 'Sal', quantidade: '1', unidade: 'g' }] })
    await plan(headers, r, '2026-10-10', 'almoco') // fora da semana pedida

    const res = await planToList({ from: MON, to: SUN, listId }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'plano_vazio' })

    const bad = await planToList({ from: SUN, to: MON, listId }, headers)
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toMatchObject({ error: 'intervalo_invalido' })
    expect((await planToList({ from: MON, to: '2026-10-12', listId }, headers)).status).toBe(400)

    expect(((await (await getItems(listId, headers)).json()) as ItemsBody).items).toEqual([])
  })

  it('o "gerar lista" aceita no máximo 7 dias (uma semana)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const r = await seedCatalogRecipe({ ingredients: [{ rawText: 'Sal', quantidade: '1', unidade: 'g' }] })
    await plan(headers, r, MON, 'almoco')

    expect((await planToList({ from: MON, to: SUN, listId }, headers)).status).toBe(200)
    const oito = await planToList({ from: MON, to: '2026-10-05', listId }, headers)
    expect(oito.status).toBe(400)
    await expect(oito.json()).resolves.toMatchObject({ error: 'intervalo_invalido' })
  })

  it('newListName cria a Lista E soma nela no mesmo POST; devolve a lista criada', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalogRecipe({ porcoes: 2, ingredients: [{ rawText: 'Arroz', quantidade: '200', unidade: 'g' }] })
    await plan(headers, r, MON, 'almoco', 4)

    const res = await planToList({ from: MON, to: SUN, newListName: '  Semana 28/09  ' }, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ToListBody
    expect(body).toMatchObject({ ok: true, addedCount: 1, list: { name: 'Semana 28/09' } })
    const lists = await getDb().select().from(shoppingList).where(eq(shoppingList.userId, userId))
    expect(lists.map((l) => l.id)).toEqual([body.list.id])
    const { items } = (await (await getItems(body.list.id, headers)).json()) as ItemsBody
    expect(items.find((i) => i.nome === 'Arroz')).toMatchObject({ quantidade: '400.000', unidade: 'g' })

    // Mesmo nome de novo ⇒ 409 nome_duplicado (a UI então escolhe a existente).
    const dup = await planToList({ from: MON, to: SUN, newListName: 'Semana 28/09' }, headers)
    expect(dup.status).toBe(409)
    await expect(dup.json()).resolves.toMatchObject({ error: 'nome_duplicado' })
  })

  it('newListName com período VAZIO ⇒ 422 plano_vazio e NENHUMA lista criada (sem lista órfã)', async () => {
    const { userId, headers } = await session()
    const res = await planToList({ from: MON, to: SUN, newListName: 'Órfã' }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'plano_vazio' })
    expect(await getDb().select().from(shoppingList).where(eq(shoppingList.userId, userId))).toEqual([])
  })

  it('newListName com SÓ Receitas indisponíveis no período ⇒ 422 plano_vazio e a lista NÃO fica (rollback)', async () => {
    const { userId, headers } = await session()
    const owner = await session()
    const publica = await seedUserRecipe(owner.userId, 'public', 'Pública')
    await seedRecipeIngredient({ recipeId: publica, ordem: 0, rawText: 'Segredo', quantidade: '1', unidade: 'g' })
    await plan(headers, publica, MON, 'almoco')
    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, publica))

    const res = await planToList({ from: MON, to: SUN, newListName: 'Só indisponíveis' }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'plano_vazio' })
    expect(await getDb().select().from(shoppingList).where(eq(shoppingList.userId, userId))).toEqual([])
  })

  it('newListName no teto de Listas ⇒ 422 limite_listas (nada criado além do teto)', async () => {
    const { userId, headers } = await session()
    const r = await seedCatalogRecipe({ ingredients: [{ rawText: 'Sal', quantidade: '1', unidade: 'g' }] })
    await plan(headers, r, MON, 'almoco')
    await getDb()
      .insert(shoppingList)
      .values(Array.from({ length: MAX_SHOPPING_LISTS_PER_USER }, (_, i) => ({ userId, name: `Lista ${i}` })))
    const res = await planToList({ from: MON, to: SUN, newListName: 'Mais uma' }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'limite_listas' })
    expect(await getDb().select().from(shoppingList).where(eq(shoppingList.userId, userId))).toHaveLength(
      MAX_SHOPPING_LISTS_PER_USER,
    )
  })

  it('newListName em branco ⇒ 400 nome_invalido; sem listId nem newListName ⇒ 404 (como listId inválido)', async () => {
    const { headers } = await session()
    const r = await seedCatalogRecipe({ ingredients: [{ rawText: 'Sal', quantidade: '1', unidade: 'g' }] })
    await plan(headers, r, MON, 'almoco')
    const blank = await planToList({ from: MON, to: SUN, newListName: '   ' }, headers)
    expect(blank.status).toBe(400)
    await expect(blank.json()).resolves.toMatchObject({ error: 'nome_invalido' })
    expect((await planToList({ from: MON, to: SUN }, headers)).status).toBe(404)
  })

  it('a mesma Receita em dois dias com porções diferentes: escala cada uma e SOMA numa linha', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    // Receita pra 4 porções com 200 g de farinha: 2 porções ⇒ 100 g; 8 porções ⇒ 400 g; total 500 g.
    const bolo = await seedCatalogRecipe({
      titulo: 'Bolo',
      porcoes: 4,
      ingredients: [{ rawText: 'Farinha', quantidade: '200', unidade: 'g' }],
    })
    // Receita SEM porções declaradas, planejada com porções-alvo ⇒ entra na base + aviso.
    const salada = await seedCatalogRecipe({
      titulo: 'Salada',
      porcoes: null,
      ingredients: [{ rawText: 'Alface', quantidade: '1', unidade: 'unidade' }],
    })
    // Fora do intervalo pedido: não pode entrar.
    const fora = await seedCatalogRecipe({
      titulo: 'Fora',
      porcoes: 2,
      ingredients: [{ rawText: 'Chocolate', quantidade: '100', unidade: 'g' }],
    })

    await plan(headers, bolo, TUE, 'lanche', 2)
    await plan(headers, bolo, '2026-10-03', 'lanche', 8)
    await plan(headers, salada, WED, 'almoco', 3)
    await plan(headers, fora, '2026-10-05', 'jantar', 2)
    await plan(headers, fora, '2026-09-27', 'jantar', 2)

    const res = await planToList({ from: MON, to: SUN, listId }, headers)
    expect(res.status).toBe(200)
    expect((await res.json()) as ToListBody).toEqual({
      ok: true,
      list: { id: listId, name: expect.any(String) },
      addedCount: 3,
      skippedCount: 0,
      semPorcoesCount: 1,
    })

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(2)
    expect(items.find((i) => i.nome === 'Farinha')).toMatchObject({ quantidade: '500.000', unidade: 'g' })
    expect(items.find((i) => i.nome === 'Alface')).toMatchObject({ quantidade: '1.000', unidade: 'unidade' })
    expect(items.find((i) => i.nome === 'Chocolate')).toBeUndefined()
  })

  it('entrada sem porções (null) entra na BASE, sem aviso de sem_porcoes', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const r = await seedCatalogRecipe({ porcoes: null, ingredients: [{ rawText: 'Leite', quantidade: '200', unidade: 'ml' }] })
    await plan(headers, r, MON, 'cafe_da_manha')

    const res = await planToList({ from: MON, to: MON, listId }, headers)
    expect((await res.json()) as ToListBody).toMatchObject({ addedCount: 1, skippedCount: 0, semPorcoesCount: 0 })
    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items.find((i) => i.nome === 'Leite')).toMatchObject({ quantidade: '200.000', unidade: 'ml' })
  })

  it('Receita que ficou inelegível é PULADA (skippedCount), as demais entram', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const owner = await session()
    const publica = await seedUserRecipe(owner.userId, 'public', 'Pública')
    await seedRecipeIngredient({ recipeId: publica, ordem: 0, rawText: 'Segredo', quantidade: '1', unidade: 'g' })
    const ok = await seedCatalogRecipe({ ingredients: [{ rawText: 'Alho', quantidade: '2', unidade: 'dente' }] })
    await plan(headers, publica, MON, 'almoco')
    await plan(headers, ok, MON, 'jantar')
    await getDb().update(recipe).set({ visibility: 'private' }).where(eq(recipe.id, publica))

    const res = await planToList({ from: MON, to: SUN, listId }, headers)
    expect((await res.json()) as ToListBody).toMatchObject({ addedCount: 1, skippedCount: 1 })
    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items.map((i) => i.nome)).toEqual(['Alho'])
  })

  it('só o plano do PRÓPRIO usuário vira lista (o de outro no mesmo intervalo não entra)', async () => {
    const a = await session()
    const b = await session()
    const listA = await seedList(a.userId)
    const ra = await seedCatalogRecipe({ ingredients: [{ rawText: 'Arroz', quantidade: '1', unidade: 'kg' }] })
    const rb = await seedCatalogRecipe({ ingredients: [{ rawText: 'Feijão', quantidade: '1', unidade: 'kg' }] })
    await plan(a.headers, ra, MON, 'almoco')
    await plan(b.headers, rb, MON, 'almoco')

    const res = await planToList({ from: MON, to: SUN, listId: listA }, a.headers)
    expect((await res.json()) as ToListBody).toMatchObject({ addedCount: 1 })
    const { items } = (await (await getItems(listA, a.headers)).json()) as ItemsBody
    expect(items.map((i) => i.nome)).toEqual(['Arroz'])
  })
})
