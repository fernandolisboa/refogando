import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { shoppingList, recipeIngredient } from '@/db/schema'
import { GET as itemsGetRoute, POST as itemsPostRoute } from '@/app/api/me/shopping-lists/[listId]/items/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'

/**
 * Adicionar-de-receita + agregação (fatia A2, issue #526, ADR-0032 dec.2/4) — o TRACER, pela porta
 * mais alta (route handlers). `setup.ts` aponta o DI pro Postgres descartável e trunca antes de
 * cada teste. Modelo de invocação: shopping-lists.test.ts (A1).
 */

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function jsonReq(url: string, method: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function getItems(listId: string, headers?: Headers, locale?: string): Promise<Response> {
  const q = locale ? `?locale=${locale}` : ''
  return itemsGetRoute(jsonReq(`/api/me/shopping-lists/${listId}/items${q}`, 'GET', headers), {
    params: Promise.resolve({ listId }),
  })
}
function addRecipe(
  listId: string,
  recipeId: unknown,
  headers?: Headers,
  locale?: string,
): Promise<Response> {
  const q = locale ? `?locale=${locale}` : ''
  return itemsPostRoute(
    jsonReq(`/api/me/shopping-lists/${listId}/items${q}`, 'POST', headers, { recipeId }),
    { params: Promise.resolve({ listId }) },
  )
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session() {
  return seedSessionHeaders({ email: `sla-${seq++}-${crypto.randomUUID()}@ex.com` })
}
async function seedList(userId: string, name = 'Lista'): Promise<string> {
  const [row] = await getDb().insert(shoppingList).values({ userId, name }).returning({ id: shoppingList.id })
  return row.id
}

type ItemView = {
  id: string
  nome: string
  quantidade: string | null
  unidade: string | null
  ingredientId: string | null
  sourceRecipeId: string | null
}
type ItemsBody = { list: { id: string; name: string }; items: ItemView[] }

async function seedCatalogRecipe(
  ingredients: { rawText: string; quantidade?: string | null; unidade?: string | null }[],
): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Receita de teste', provenance: 'escrita_por_pessoa' })
  let ordem = 0
  for (const ing of ingredients) {
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

function byNome(items: ItemView[], nome: string): ItemView | undefined {
  return items.find((i) => i.nome === nome)
}

// ── Merge/agregação ───────────────────────────────────────────────────────────
describe('Adicionar Receita à Lista — merge/agregação (#526)', () => {
  it('mesmo ingrediente, mesma unidade (dentro da MESMA Receita): soma numa linha', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([
      { rawText: 'Farinha', quantidade: '200', unidade: 'g' },
      { rawText: 'Farinha', quantidade: '100', unidade: 'g' },
    ])

    const res = await addRecipe(listId, recipeId, headers)
    expect(res.status).toBe(200)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    // numeric(10,3) sempre volta com 3 casas do Postgres (mesma tese de `seedRecipeIngredient`).
    expect(byNome(items, 'Farinha')).toMatchObject({ quantidade: '300.000', unidade: 'g' })
  })

  it('mesmo ingrediente, unidades DIFERENTES (entre DUAS Receitas): linhas separadas, nunca converte', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([{ rawText: 'Leite', quantidade: '200', unidade: 'ml' }])
    const recipeB = await seedCatalogRecipe([{ rawText: 'Leite', quantidade: '1', unidade: 'l' }])

    expect((await addRecipe(listId, recipeA, headers)).status).toBe(200)
    expect((await addRecipe(listId, recipeB, headers)).status).toBe(200)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    const leites = items.filter((i) => i.nome === 'Leite')
    expect(leites).toHaveLength(2)
    const byUnidade = Object.fromEntries(leites.map((l) => [l.unidade, l.quantidade]))
    expect(byUnidade).toEqual({ ml: '200.000', l: '1.000' })
  })

  it('mesmo ingrediente ENTRE receitas, mesma unidade: soma via upsert no banco', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '200', unidade: 'g' }])
    const recipeB = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '150', unidade: 'g' }])

    await addRecipe(listId, recipeA, headers)
    await addRecipe(listId, recipeB, headers)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantidade: '350.000', unidade: 'g' })
  })

  it('"a gosto" (sem número) fica em linha própria, sem número — nunca soma nulls', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([
      { rawText: 'Sal', quantidade: null, unidade: 'a_gosto' },
    ])

    await addRecipe(listId, recipeId, headers)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ nome: 'Sal', quantidade: null, unidade: 'a_gosto' })
  })

  it('quantidade presente + "a gosto" da mesma chave (unidade diferente): NÃO mescla, preserva ambas', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([{ rawText: 'Sal', quantidade: '1', unidade: 'colher_de_cha' }])
    const recipeB = await seedCatalogRecipe([{ rawText: 'Sal', quantidade: null, unidade: 'a_gosto' }])

    await addRecipe(listId, recipeA, headers)
    await addRecipe(listId, recipeB, headers)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    const sais = items.filter((i) => i.nome === 'Sal')
    expect(sais).toHaveLength(2)
    const byUnidade = Object.fromEntries(sais.map((s) => [s.unidade, s.quantidade]))
    expect(byUnidade).toEqual({ colher_de_cha: '1.000', a_gosto: null })
  })

  it('nome normalizado mescla "Açúcar"/"acucar" (nomes de superfície diferentes, mesma chave)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([
      { rawText: 'Açúcar', quantidade: '2', unidade: 'colher_de_sopa' },
    ])
    const recipeB = await seedCatalogRecipe([
      { rawText: 'acucar', quantidade: '1', unidade: 'colher_de_sopa' },
    ])

    await addRecipe(listId, recipeA, headers)
    await addRecipe(listId, recipeB, headers)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(items[0].quantidade).toBe('3.000')
  })

  it('re-adicionar a MESMA Receita mescla (idempotência): soma, sem duplicar linha; proveniência preservada', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '200', unidade: 'g' }])

    await addRecipe(listId, recipeId, headers)
    await addRecipe(listId, recipeId, headers) // re-adicionar

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ quantidade: '400.000', sourceRecipeId: recipeId })
  })

  it('mesclar de DUAS receitas diferentes zera a proveniência (source_recipe_id ⇒ NULL)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeA = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '200', unidade: 'g' }])
    const recipeB = await seedCatalogRecipe([{ rawText: 'Farinha', quantidade: '100', unidade: 'g' }])

    await addRecipe(listId, recipeA, headers)
    await addRecipe(listId, recipeB, headers)

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(items[0].sourceRecipeId).toBeNull()
  })

  it('snapshot: editar a Receita de origem DEPOIS não muda a linha da lista', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Camarão', quantidade: '500', unidade: 'g' }])

    await addRecipe(listId, recipeId, headers)

    // Edita o Item de origem DIRETO (fora do fluxo de "editar Receita", mas o efeito é o mesmo:
    // muda o raw_text/quantidade daquele Item). A linha da lista NÃO deve refletir a mudança.
    await getDb()
      .update(recipeIngredient)
      .set({ rawText: 'Camarão gigante', quantidade: '999' })
      .where(eq(recipeIngredient.recipeId, recipeId))

    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ nome: 'Camarão', quantidade: '500.000' })
  })

  it('nome resolvido no locale do usuário no momento do add', async () => {
    const { userId, headers } = await session()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Receita de teste',
      provenance: 'escrita_por_pessoa',
    })
    await seedTranslation({
      recipeId,
      locale: 'en-US',
      titulo: 'Test recipe',
      provenance: 'automatica_revisada',
      ingredientes: [{ ordem: 0, nome: 'shrimp', nomeOrigem: 'camarão' }],
    })
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: 'camarão', quantidade: '500', unidade: 'g' })

    // locale pt-BR (default): sem tradução própria (original) ⇒ cai no rawText.
    const listA = await seedList(userId, 'A')
    await addRecipe(listA, recipeId, headers, 'pt-BR')
    const itemsA = ((await (await getItems(listA, headers)).json()) as ItemsBody).items
    expect(itemsA[0].nome).toBe('camarão')

    // locale en-US: usa o nome TRADUZIDO (nomeOrigem bate com o rawText atual).
    const listB = await seedList(userId, 'B')
    await addRecipe(listB, recipeId, headers, 'en-US')
    const itemsB = ((await (await getItems(listB, headers)).json()) as ItemsBody).items
    expect(itemsB[0].nome).toBe('shrimp')
  })

  it('Receita sem ingredientes nomeados: no-op válido (200, lista continua vazia)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Vazia', provenance: 'escrita_por_pessoa' })

    const res = await addRecipe(listId, recipeId, headers)
    expect(res.status).toBe(200)
    const { items } = (await (await getItems(listId, headers)).json()) as ItemsBody
    expect(items).toHaveLength(0)
  })
})

// ── Gate (dono + elegibilidade da Receita) ───────────────────────────────────────
describe('Gate de dono + elegibilidade da Receita', () => {
  it('rotas exigem sessão (401 anônimo)', async () => {
    const someId = crypto.randomUUID()
    expect((await getItems(someId)).status).toBe(401)
    expect((await addRecipe(someId, someId)).status).toBe(401)
  })

  it('lista de OUTRO usuário ⇒ 404 leak-safe (nunca revela se a receita seria elegível)', async () => {
    const a = await session()
    const b = await session()
    const listB = await seedList(b.userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Sal', quantidade: '1', unidade: 'g' }])

    expect((await getItems(listB, a.headers)).status).toBe(404)
    expect((await addRecipe(listB, recipeId, a.headers)).status).toBe(404)
  })

  it('recipeId inexistente/uuid malformado ⇒ 404', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    expect((await addRecipe(listId, crypto.randomUUID(), headers)).status).toBe(404)
    expect((await addRecipe(listId, 'not-a-uuid', headers)).status).toBe(404)
  })

  it('Receita PRIVADA de OUTRO usuário ⇒ 404 (não elegível)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const owner = await session()
    const recipeId = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: owner.userId,
    })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Privada', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: 'Sal', quantidade: '1', unidade: 'g' })

    expect((await addRecipe(listId, recipeId, headers)).status).toBe(404)
  })

  it('Receita PÚBLICA de comunidade (de outro dono) PODE ser adicionada', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const owner = await session()
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: owner.userId,
    })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Pública', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: 'Alho', quantidade: '2', unidade: 'dente' })

    const res = await addRecipe(listId, recipeId, headers)
    expect(res.status).toBe(200)
  })

  it('Receita do CATÁLOGO (owner NULL, aprovada) PODE ser adicionada', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedCatalogRecipe([{ rawText: 'Manteiga', quantidade: '50', unidade: 'g' }])

    const res = await addRecipe(listId, recipeId, headers)
    expect(res.status).toBe(200)
  })

  it('a PRÓPRIA Receita PRIVADA pode ser adicionada (escape-hatch de ownership)', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId)
    const recipeId = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Minha privada', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId, ordem: 0, rawText: 'Ovo', quantidade: '2', unidade: 'unidade' })

    const res = await addRecipe(listId, recipeId, headers)
    expect(res.status).toBe(200)
  })

  it('GET vê os itens consolidados da própria lista', async () => {
    const { userId, headers } = await session()
    const listId = await seedList(userId, 'Compras')
    const recipeId = await seedCatalogRecipe([{ rawText: 'Arroz', quantidade: '1', unidade: 'kg' }])
    await addRecipe(listId, recipeId, headers)

    const res = await getItems(listId, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ItemsBody
    expect(body.list).toMatchObject({ id: listId, name: 'Compras' })
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ nome: 'Arroz', quantidade: '1.000', unidade: 'kg' })
  })
})
