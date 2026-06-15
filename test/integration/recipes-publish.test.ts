import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { POST as publishRoute } from '@/app/api/recipes/[id]/publish/route'
import { POST as unpublishRoute } from '@/app/api/recipes/[id]/unpublish/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import type { ResultKind } from '@/domain/recipe'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Publicar/despublicar pela porta mais alta — handlers POST (issue #13). `setup.ts`
 * aponta o DI para o Postgres descartável e trunca antes de cada teste. Invariantes
 * cruas usam um cliente RAW postgres-js (`makeSql`) — só assim o `PostgresError`
 * carrega `.code` no TOPO (sob Drizzle viria em `(err.cause as PostgresError).code`).
 * Modelo: recipes-get.test.ts + recipe-constraints.test.ts.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function publish(id: string, headers?: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return publishRoute(new Request(`http://localhost/api/recipes/${id}/publish${qs}`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}

function unpublish(id: string, headers?: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return unpublishRoute(new Request(`http://localhost/api/recipes/${id}/unpublish${qs}`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Lê a Receita pela porta alta (GET da #3) — sem headers = leitura ANÔNIMA (terceiro). */
function get(id: string, headers?: Headers): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Lê visibility + origin direto do banco (asserts de estado; a view não expõe visibility). */
async function readState(id: string): Promise<{ visibility: string; origin: string }> {
  const [row] = await getDb()
    .select({ visibility: recipe.visibility, origin: recipe.origin })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row
}

/** Lê updatedAt direto do banco (prova de no-op: UPDATE redundante bumparia este valor). */
async function readUpdatedAt(id: string): Promise<Date> {
  const [row] = await getDb().select({ updatedAt: recipe.updatedAt }).from(recipe).where(eq(recipe.id, id))
  return row.updatedAt
}

describe('POST /api/recipes/[id]/publish', () => {
  // (a) self-publish private→public por dono — parametrizado success/degraded (E6).
  it.each<ResultKind>(['success', 'degraded'])(
    '(a) dono publica private→public [%s]: 200 + banco public + origin inalterado',
    async (resultKind) => {
      const { userId, headers } = await seedSessionHeaders({ email: `owner-${resultKind}@ex.com` })
      const id = await seedRecipe({
        origin: 'ai_chat',
        originalLocale: 'pt-BR',
        visibility: 'private',
        resultKind,
        ownerId: userId,
      })
      await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

      const res = await publish(id, headers)
      expect(res.status).toBe(200)
      const view = (await res.json()) as { id: string }
      expect(view.id).toBe(id)

      const state = await readState(id)
      expect(state.visibility).toBe('public')
      expect(state.origin).toBe('ai_chat') // publicar NÃO vira origin='catalog'
    },
  )

  // (b) despublicar public→private por dono.
  it('(b) dono despublica public→private: 200 + banco private', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-unpub@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

    const res = await unpublish(id, headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string }
    expect(view.id).toBe(id)

    const state = await readState(id)
    expect(state.visibility).toBe('private')
  })

  // (c) publicar playful: 422 + banco continua private + invariante CRUA 23514.
  it('(c) publicar playful ⇒ 422 playful_nao_publicavel; banco continua private', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-playful@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'playful',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Zoeira', provenance: 'escrita_por_pessoa' })

    const res = await publish(id, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'playful_nao_publicavel' })

    const state = await readState(id)
    expect(state.visibility).toBe('private')
  })

  it('(c) invariante CRUA: UPDATE visibility=public num playful ⇒ PostgresError 23514', async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale, result_kind, visibility)
      VALUES ('ai_chat', 'pt-BR', 'playful', 'private')
      RETURNING id
    `
    let err: unknown
    try {
      await sql`UPDATE recipe SET visibility = 'public' WHERE id = ${row.id}`
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23514')
  })

  // (d) publicar NÃO muda origin (já assertado em (a)) + invariante CRUA P0001.
  it('(d) invariante CRUA: UPDATE origin=catalog ⇒ PostgresError P0001; só visibility SUCEDE', async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO recipe (origin, original_locale, result_kind, visibility)
      VALUES ('ai_chat', 'pt-BR', 'success', 'private')
      RETURNING id
    `
    const id = row.id

    let err: unknown
    try {
      await sql`UPDATE recipe SET origin = 'catalog' WHERE id = ${id}`
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('P0001') // trigger recipe_origin_immutable

    // UPDATE que toca SÓ visibility (o que a rota faz) passa pelo trigger sem erro.
    const updated = await sql<{ id: string }[]>`
      UPDATE recipe SET visibility = 'public' WHERE id = ${id} RETURNING id
    `
    expect(updated).toHaveLength(1)
  })

  // (e)/(f) blindagem das rotas GÊMEAS: os gates de auth (401 sem sessão) e de posse
  // (404 não-dono) DEVEM valer igual para publish E unpublish. Parametrizado sobre as
  // duas rotas: se alguém um dia divergir só uma (ex.: tirar requireSession do unpublish),
  // este teste pega. Cada caso assere status + corpo + banco inalterado para a rota dada.
  const twinRoutes: ReadonlyArray<[string, typeof publish]> = [
    ['publish', publish],
    ['unpublish', unpublish],
  ]

  // (e) não-dono autenticado (sessão userB numa receita de userA) ⇒ 404, banco inalterado.
  it.each(twinRoutes)(
    '(e) %s: não-dono autenticado ⇒ 404 not_found; banco inalterado (não vaza existência)',
    async (_name, route) => {
      const { userId: userA } = await seedSessionHeaders({ email: `owner-a-${_name}@ex.com` })
      const { headers: headersB } = await seedSessionHeaders({ email: `intruder-b-${_name}@ex.com` })
      const id = await seedRecipe({
        origin: 'ai_chat',
        originalLocale: 'pt-BR',
        visibility: 'private',
        resultKind: 'success',
        ownerId: userA,
      })
      await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

      const res = await route(id, headersB)
      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })

      const state = await readState(id)
      expect(state.visibility).toBe('private') // banco inalterado
    },
  )

  // (f) sem sessão ⇒ 401 nao_autenticado; banco inalterado, zero efeito colateral.
  it.each(twinRoutes)(
    '(f) %s: sem sessão ⇒ 401 nao_autenticado; banco inalterado (zero efeito colateral)',
    async (_name, route) => {
      const { userId } = await seedSessionHeaders({ email: `owner-nosession-${_name}@ex.com` })
      const id = await seedRecipe({
        origin: 'ai_chat',
        originalLocale: 'pt-BR',
        visibility: 'private',
        resultKind: 'success',
        ownerId: userId,
      })
      await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

      const res = await route(id) // sem headers
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

      const state = await readState(id)
      expect(state.visibility).toBe('private') // o 401 não pode ter tocado o estado
    },
  )

  // (g1) idempotência: publish 2× pelo dono ⇒ 200/200, banco final public; 2º é no-op (sem bump de updatedAt).
  it('(g1) publish 2× pelo dono ⇒ 200/200, banco public; 2º é no-op (updatedAt inalterado)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-idem-pub@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'success',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

    const first = await publish(id, headers)
    expect(first.status).toBe(200)
    const afterFirst = await readUpdatedAt(id)

    const second = await publish(id, headers)
    expect(second.status).toBe(200)

    const state = await readState(id)
    expect(state.visibility).toBe('public')
    // 2º publish numa já-pública = no-op: NÃO faz UPDATE, então updatedAt não muda (E2).
    expect(await readUpdatedAt(id)).toEqual(afterFirst)
  })

  // (g2) idempotência: unpublish numa já-privada ⇒ 200 no-op, banco private, updatedAt inalterado.
  it('(g2) unpublish numa já-privada ⇒ 200 no-op; banco private; updatedAt inalterado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-idem-unpub@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'success',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

    const beforeNoop = await readUpdatedAt(id)
    const res = await unpublish(id, headers)
    expect(res.status).toBe(200)

    const state = await readState(id)
    expect(state.visibility).toBe('private')
    // no-op (alvo == atual): nenhum UPDATE, updatedAt intacto.
    expect(await readUpdatedAt(id)).toEqual(beforeNoop)
  })

  // (h) catálogo (owner_id NULL) ⇒ publish E unpublish por qualquer usuário ⇒ 404 (nunca dono).
  it('(h) catálogo (owner_id NULL) ⇒ publish e unpublish ⇒ 404 (usuário nunca é dono)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'someone@ex.com' })
    const id = await seedRecipe({
      origin: 'catalog',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId: null,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })

    const pub = await publish(id, headers)
    expect(pub.status).toBe(404)
    await expect(pub.json()).resolves.toMatchObject({ error: 'not_found' })

    const unpub = await unpublish(id, headers)
    expect(unpub.status).toBe(404)
    await expect(unpub.json()).resolves.toMatchObject({ error: 'not_found' })

    // Catálogo intacto.
    const state = await readState(id)
    expect(state.visibility).toBe('public')
    expect(state.origin).toBe('catalog')
  })

  // (i) id inválido (não-uuid) ⇒ 404 (curto-circuito isUuid, sem 500); uuid inexistente ⇒ 404 (gate vazio).
  it('(i) id inválido (não-uuid) ⇒ 404 sem 500 (curto-circuito isUuid)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'owner-badid@ex.com' })
    const res = await publish('not-a-uuid', headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('(i) uuid inexistente (sem linha) ⇒ 404 (gate vazio)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'owner-noid@ex.com' })
    const res = await publish('00000000-0000-0000-0000-000000000000', headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  // (j) publish devolve view localizada (?locale ≠ originalLocale), espelhando recipes-get AC#1.
  it('(j) publish com ?locale=en-US ⇒ 200 e view.name na forma localizada (parênteses)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-locale@ex.com' })
    const tituloPt = 'Bolo de Fubá'
    const tituloEn = 'Cornmeal Cake'
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'success',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: tituloPt, provenance: 'escrita_por_pessoa' })
    // en-US confiável (provenance ≠ automatica_nao_revisada) e título diferente ⇒ parênteses.
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: tituloEn, provenance: 'automatica_revisada' })

    const res = await publish(id, headers, 'en-US')
    expect(res.status).toBe(200)
    const view = (await res.json()) as { name: string }
    // Original primário + tradução confiável e diferente entre parênteses (espelha GET AC#1).
    expect(view.name).toBe(`${tituloPt} (${tituloEn})`)

    const state = await readState(id)
    expect(state.visibility).toBe('public')
  })

  // (k) AC#1 pelo COMPORTAMENTO: publicar ENTRA no pool / despublicar SAI do pool, provado
  // por leitura ANÔNIMA (terceiro) via o GET da #3 — não só pela coluna visibility. Privada
  // não vaza (404); pública é legível por qualquer um (200); despublicar volta a 404.
  it('(k) ciclo de pool: privada→404 p/ terceiro; publish→200; unpublish→404 (entra/sai do pool)', async () => {
    const { userId: userA, headers: headersA } = await seedSessionHeaders({ email: 'owner-pool@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'success',
      ownerId: userA,
    })
    // view monta name a partir do originalLocale (pt-BR).
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

    // Antes de publicar: leitura ANÔNIMA (sem sessão = terceiro mais forte) NÃO enxerga a privada.
    const before = await get(id)
    expect(before.status).toBe(404)
    await expect(before.json()).resolves.toMatchObject({ error: 'not_found' })

    // Dono publica → entra no pool.
    const pub = await publish(id, headersA)
    expect(pub.status).toBe(200)

    // Agora o terceiro anônimo LÊ a receita (200) — observabilidade real do pool público.
    const afterPub = await get(id)
    expect(afterPub.status).toBe(200)
    const view = (await afterPub.json()) as { id: string }
    expect(view.id).toBe(id)

    // Dono despublica → sai do pool.
    const unpub = await unpublish(id, headersA)
    expect(unpub.status).toBe(200)

    // Terceiro anônimo volta a NÃO enxergar (404) — saiu do pool.
    const afterUnpub = await get(id)
    expect(afterUnpub.status).toBe(404)
    await expect(afterUnpub.json()).resolves.toMatchObject({ error: 'not_found' })
  })
})
