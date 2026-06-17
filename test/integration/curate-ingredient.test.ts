import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { POST as createRoute } from '@/app/api/curate/ingredients/route'
import { PATCH as updateRoute } from '@/app/api/curate/ingredients/[id]/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { getDb } from '@/server/deps'
import { ingredient, ingredientTranslation } from '@/db/schema'
import { updateIngredient } from '@/server/curate/ingredient'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedIngredient,
  seedIngredientTranslation,
  seedRecipeIngredient,
} from '../helpers/recipes'

/**
 * Base canônica de Ingrediente (issue #19) — AC3 create/update nome/aliases/alérgeno +
 * AC4 alérgeno acende o Aviso #7 — pela porta MAIS ALTA. Normalização de alérgeno na
 * ESCRITA provada por read-back da COLUNA (não pelo motor, que normaliza na leitura).
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function withJson(base?: Headers): Headers {
  const h = base ? new Headers(base) : new Headers()
  h.set('content-type', 'application/json')
  return h
}

async function curadorHeaders(): Promise<Headers> {
  const { headers } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com`, role: 'curador' })
  return headers
}

function create(body: unknown, headers?: Headers): Promise<Response> {
  return createRoute(
    new Request('http://localhost/api/curate/ingredients', { method: 'POST', headers: withJson(headers), body: JSON.stringify(body) }),
  )
}

function update(id: string, body: unknown, headers?: Headers): Promise<Response> {
  return updateRoute(
    new Request(`http://localhost/api/curate/ingredients/${id}`, { method: 'PATCH', headers: withJson(headers), body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )
}

function getRecipe(id: string, locale: string): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}?locale=${encodeURIComponent(locale)}`), {
    params: Promise.resolve({ id }),
  })
}

const validCreate = { translations: [{ locale: 'pt-BR', nome: 'cebola-roxa', aliases: ['cebola roxa'] }] }

describe('POST/PATCH /api/curate/ingredients #19 — AC3', () => {
  it('matriz de gating (POST)', async () => {
    expect((await create(validCreate)).status).toBe(401)
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com`, role: 'usuario' })
    expect((await create(validCreate, u)).status).toBe(403)
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await create(validCreate, c)).status).toBe(200)
    const { headers: a } = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com`, role: 'admin' })
    expect((await create(validCreate, a)).status).toBe(200)
    const { headers: d } = await seedDeletedSessionHeaders({ email: `d-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await create(validCreate, d)).status).toBe(401)
  })

  it('matriz de gating (PATCH)', async () => {
    const id = await seedIngredient({ slug: null })
    const body = { alergenos: ['trigo'] }
    expect((await update(id, body)).status).toBe(401)
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com`, role: 'usuario' })
    expect((await update(id, body, u)).status).toBe(403)
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await update(id, body, c)).status).toBe(200)
    const { headers: a } = await seedSessionHeaders({ email: `a-${crypto.randomUUID()}@ex.com`, role: 'admin' })
    expect((await update(id, body, a)).status).toBe(200)
    const { headers: d } = await seedDeletedSessionHeaders({ email: `d-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await update(id, body, d)).status).toBe(401)
  })

  it('POST create: persiste slug + alergenos NORMALIZADO + traduções', async () => {
    const headers = await curadorHeaders()
    const slug = `cebola-${crypto.randomUUID()}`
    const res = await create(
      {
        slug,
        alergenos: ['Trigo', 'GLÚTEN '],
        translations: [
          { locale: 'pt-BR', nome: 'cebola-roxa', aliases: ['cebola roxa'] },
          { locale: 'en-US', nome: 'red onion' },
        ],
      },
      headers,
    )
    expect(res.status).toBe(200)
    const { id } = (await res.json()) as { id: string }

    const db = getDb()
    const [ing] = await db.select({ slug: ingredient.slug, alergenos: ingredient.alergenos }).from(ingredient).where(eq(ingredient.id, id))
    expect(ing.slug).toBe(slug)
    // read-back da COLUNA: prova REAL da normalização-na-escrita (lower+sem-acento+trim).
    expect(ing.alergenos).toEqual(['trigo', 'gluten'])

    const trs = await db.select({ locale: ingredientTranslation.locale, nome: ingredientTranslation.nome, aliases: ingredientTranslation.aliases }).from(ingredientTranslation).where(eq(ingredientTranslation.ingredientId, id)).orderBy(ingredientTranslation.locale)
    expect(trs).toHaveLength(2)
    const pt = trs.find((t) => t.locale === 'pt-BR')!
    expect(pt.nome).toBe('cebola-roxa') // SURFACE FORM (não normalizado)
    expect(pt.aliases).toEqual(['cebola roxa'])
    expect(trs.find((t) => t.locale === 'en-US')!.nome).toBe('red onion')
  })

  it('POST validação: locale inválido → 400; locale duplicado → 400', async () => {
    const headers = await curadorHeaders()
    expect((await create({ translations: [{ locale: 'fr-FR', nome: 'x' }] }, headers)).status).toBe(400)
    expect((await create({ translations: [{ locale: 'pt-BR', nome: 'x' }, { locale: 'pt-BR', nome: 'y' }] }, headers)).status).toBe(400)
    // nome ausente
    expect((await create({ translations: [{ locale: 'pt-BR', nome: '' }] }, headers)).status).toBe(400)
  })

  it('POST exige ≥1 tradução: ausente → 400; [] → 400; nenhuma linha ingredient persiste', async () => {
    const headers = await curadorHeaders()
    const [{ n: n0 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ingredient`

    const omitted = await create({ slug: `x-${crypto.randomUUID()}` }, headers)
    expect(omitted.status).toBe(400)
    expect(await omitted.json()).toEqual({ error: 'dados_invalidos' })

    const empty = await create({ slug: `y-${crypto.randomUUID()}`, translations: [] }, headers)
    expect(empty.status).toBe(400)

    const [{ n: n1 }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ingredient`
    expect(n1).toBe(n0) // nada persistiu
  })

  it('UNIQUE slug: 2º POST com mesmo slug → 409 slug_em_uso; exatamente 1 linha persiste', async () => {
    const headers = await curadorHeaders()
    const slug = `dup-${crypto.randomUUID()}`
    const first = await create({ slug, translations: [{ locale: 'pt-BR', nome: 'a' }] }, headers)
    expect(first.status).toBe(200)

    const second = await create({ slug, translations: [{ locale: 'pt-BR', nome: 'b' }] }, headers)
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'slug_em_uso' })

    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ingredient WHERE slug = ${slug}`
    expect(n).toBe(1)
  })

  it('slug NULL não conflita (múltiplos NULL permitidos)', async () => {
    const headers = await curadorHeaders()
    expect((await create({ translations: [{ locale: 'pt-BR', nome: 'a' }] }, headers)).status).toBe(200)
    expect((await create({ translations: [{ locale: 'pt-BR', nome: 'b' }] }, headers)).status).toBe(200)
  })

  it('PATCH: id malformado → 404; inexistente → 404', async () => {
    const headers = await curadorHeaders()
    expect((await update('bad', { alergenos: ['trigo'] }, headers)).status).toBe(404)
    expect((await update(crypto.randomUUID(), { alergenos: ['trigo'] }, headers)).status).toBe(404)
  })

  it('PATCH: atualiza alergenos (normalizado) + upsert de tradução por locale (UPDATE e INSERT)', async () => {
    const headers = await curadorHeaders()
    const { id } = (await (await create({ translations: [{ locale: 'pt-BR', nome: 'limão', aliases: ['lima'] }] }, headers)).json()) as { id: string }

    const res = await update(
      id,
      {
        alergenos: ['Sulfito '],
        translations: [
          { locale: 'pt-BR', nome: 'limão-taiti', aliases: ['taiti'] }, // UPDATE locale existente
          { locale: 'en-US', nome: 'lime' }, // INSERT locale novo
        ],
      },
      headers,
    )
    expect(res.status).toBe(200)

    const db = getDb()
    const [ing] = await db.select({ alergenos: ingredient.alergenos }).from(ingredient).where(eq(ingredient.id, id))
    expect(ing.alergenos).toEqual(['sulfito']) // read-back: normalizado na escrita

    const [pt] = await db.select({ nome: ingredientTranslation.nome, aliases: ingredientTranslation.aliases }).from(ingredientTranslation).where(and(eq(ingredientTranslation.ingredientId, id), eq(ingredientTranslation.locale, 'pt-BR')))
    expect(pt.nome).toBe('limão-taiti') // UPDATE
    expect(pt.aliases).toEqual(['taiti']) // full-array-replace
    const [en] = await db.select({ nome: ingredientTranslation.nome }).from(ingredientTranslation).where(and(eq(ingredientTranslation.ingredientId, id), eq(ingredientTranslation.locale, 'en-US')))
    expect(en.nome).toBe('lime') // INSERT

    // mesmo locale 2x nunca duplica (UNIQUE exercitada)
    const all = await db.select({ id: ingredientTranslation.id }).from(ingredientTranslation).where(and(eq(ingredientTranslation.ingredientId, id), eq(ingredientTranslation.locale, 'pt-BR')))
    expect(all).toHaveLength(1)
  })

  it('PATCH só alérgeno (translations ausente) é válido', async () => {
    const headers = await curadorHeaders()
    const { id } = (await (await create({ translations: [{ locale: 'pt-BR', nome: 'amendoim' }] }, headers)).json()) as { id: string }
    const res = await update(id, { alergenos: ['amendoim'] }, headers)
    expect(res.status).toBe(200)
    const [ing] = await getDb().select({ alergenos: ingredient.alergenos }).from(ingredient).where(eq(ingredient.id, id))
    expect(ing.alergenos).toEqual(['amendoim'])
  })

  it('SF-F1 atomicidade: falha no 2º locale REVERTE o UPDATE de alérgeno E a 1ª tradução', async () => {
    // Estado inicial: canônico com alérgeno ['amendoim'] e UMA tradução pt-BR 'castanha'.
    const ingId = await seedIngredient({ alergenos: ['amendoim'] })
    await seedIngredientTranslation({ ingredientId: ingId, locale: 'pt-BR', nome: 'castanha' })

    // Chama o servidor DIRETO (a rota validaria `nome`): força falha determinística no 2º
    // locale via NOT NULL violation em `nome` (23502). Ordem em updateIngredient: UPDATE de
    // alérgeno → upsert pt-BR (1ª) → upsert en-US (2ª, quebra). Tudo na MESMA tx.
    await expect(
      updateIngredient(getDb(), {
        id: ingId,
        alergenos: ['gluten'], // tentaria sobrescrever ['amendoim']
        translations: [
          { locale: 'pt-BR', nome: 'castanha-do-para' }, // 1ª: UPDATE válido
          { locale: 'en-US', nome: null as unknown as string }, // 2ª: NOT NULL → quebra
        ],
      }),
    ).rejects.toThrow()

    // ROLLBACK: alérgeno inalterado, tradução pt-BR inalterada, nenhuma linha en-US.
    const db = getDb()
    const [ing] = await db.select({ alergenos: ingredient.alergenos }).from(ingredient).where(eq(ingredient.id, ingId))
    expect(ing.alergenos).toEqual(['amendoim']) // NÃO virou ['gluten']

    const trs = await db
      .select({ locale: ingredientTranslation.locale, nome: ingredientTranslation.nome })
      .from(ingredientTranslation)
      .where(eq(ingredientTranslation.ingredientId, ingId))
    expect(trs).toHaveLength(1) // nenhuma linha en-US criada
    expect(trs[0].locale).toBe('pt-BR')
    expect(trs[0].nome).toBe('castanha') // NÃO virou 'castanha-do-para'
  })
})

describe('AC4 — adicionar alérgeno acende Aviso #7', () => {
  it('antes: sem alérgeno ⇒ sem aviso; depois: alérgeno trigo ⇒ aviso dispara (pt-BR)', async () => {
    const headers = await curadorHeaders()
    // canônico SEM alérgeno, ligado a uma receita de catálogo com restricoes:['sem_gluten'].
    const { id: ingId } = (await (await create({ translations: [{ locale: 'pt-BR', nome: 'farinha' }] }, headers)).json()) as { id: string }
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, restricoes: ['sem_gluten'] })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedRecipeIngredient({ recipeId, ingredientId: ingId, ordem: 0, quantidade: '1.000', unidade: 'unidade' })

    // ANTES: alérgenos null ⇒ nenhum aviso.
    const beforeRes = await getRecipe(recipeId, 'pt-BR')
    expect(beforeRes.status).toBe(200)
    const before = (await beforeRes.json()) as { avisos?: unknown[] }
    expect(before.avisos).toBeUndefined()

    // PATCH adiciona alérgeno 'trigo'.
    expect((await update(ingId, { alergenos: ['trigo'] }, headers)).status).toBe(200)

    // DEPOIS: o Aviso dispara.
    const afterRes = await getRecipe(recipeId, 'pt-BR')
    expect(afterRes.status).toBe(200)
    const after = (await afterRes.json()) as { avisos?: { kind: string; restricao: string; alergeno: string; mensagem: string }[] }
    expect(after.avisos).toBeDefined()
    expect(after.avisos).toHaveLength(1)
    const aviso = after.avisos![0]
    expect(aviso.kind).toBe('contradicao')
    expect(aviso.restricao).toBe('sem_gluten')
    expect(aviso.alergeno).toBe('trigo')
    expect(aviso.mensagem).toContain('sem glúten') // rótulo amigável, não o código
    expect(aviso.mensagem).not.toContain('sem_gluten')
  })

  it('en-US: mesmo cenário ⇒ rótulo gluten-free', async () => {
    const headers = await curadorHeaders()
    const { id: ingId } = (await (await create({ translations: [{ locale: 'pt-BR', nome: 'farinha' }] }, headers)).json()) as { id: string }
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, restricoes: ['sem_gluten'] })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
    await seedTranslation({ recipeId, locale: 'en-US', titulo: 'Cake', provenance: 'automatica_revisada' })
    await seedRecipeIngredient({ recipeId, ingredientId: ingId, ordem: 0, quantidade: '1.000', unidade: 'unidade' })
    expect((await update(ingId, { alergenos: ['trigo'] }, headers)).status).toBe(200)

    const res = await getRecipe(recipeId, 'en-US')
    const view = (await res.json()) as { avisos?: { mensagem: string }[] }
    expect(view.avisos).toHaveLength(1)
    expect(view.avisos![0].mensagem).toContain('gluten-free')
  })
})
