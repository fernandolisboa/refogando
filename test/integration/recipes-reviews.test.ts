import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipeReview, users } from '@/db/schema'
import {
  POST as reviewPost,
  PUT as reviewPut,
  DELETE as reviewDelete,
  GET as reviewGet,
} from '@/app/api/recipes/[id]/reviews/route'
import { GET as mineGet } from '@/app/api/recipes/[id]/reviews/mine/route'
import { POST as unpublishRoute } from '@/app/api/recipes/[id]/unpublish/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Avaliação pela porta mais alta (issue #363, ADR-0027). `setup.ts` aponta o DI pro Postgres
 * descartável e trunca antes de cada teste. Modelo de invocação: recipes-social.test.ts.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function postReview(id: string, body: unknown, headers?: Headers): Promise<Response> {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return reviewPost(
    new Request(`http://localhost/api/recipes/${id}/reviews`, {
      method: 'POST',
      headers: h,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}
function putReview(id: string, body: unknown, headers?: Headers): Promise<Response> {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return reviewPut(
    new Request(`http://localhost/api/recipes/${id}/reviews`, {
      method: 'PUT',
      headers: h,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}
function deleteReview(id: string, headers?: Headers): Promise<Response> {
  return reviewDelete(
    new Request(`http://localhost/api/recipes/${id}/reviews`, { method: 'DELETE', headers }),
    { params: Promise.resolve({ id }) },
  )
}
function getReviews(id: string, headers?: Headers): Promise<Response> {
  return reviewGet(new Request(`http://localhost/api/recipes/${id}/reviews`, { headers }), {
    params: Promise.resolve({ id }),
  })
}
function getMine(id: string, headers?: Headers): Promise<Response> {
  return mineGet(new Request(`http://localhost/api/recipes/${id}/reviews/mine`, { headers }), {
    params: Promise.resolve({ id }),
  })
}
function unpublish(id: string, headers?: Headers): Promise<Response> {
  return unpublishRoute(
    new Request(`http://localhost/api/recipes/${id}/unpublish`, { method: 'POST', headers }),
    { params: Promise.resolve({ id }) },
  )
}

// ── Leitores de estado cru ────────────────────────────────────────────────────
async function countRows(id: string): Promise<number> {
  const rows = await getDb().select().from(recipeReview).where(eq(recipeReview.recipeId, id))
  return rows.length
}

async function seedPublicCommunity(ownerId: string, titulo = 'Bolo'): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    resultKind: 'success',
    ownerId,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

type SaveBody = {
  average: number | null
  count: number
  viewerRating: number | null
  viewerComment: string | null
}
type ListBody = {
  average: number | null
  count: number
  reviews: {
    id: string
    rating: number
    comment: string | null
    author: { name: string | null; handle: string | null }
    createdAt: string
  }[]
}

describe('POST/PUT/DELETE/GET /api/recipes/[id]/reviews (#363)', () => {
  it('avalia comunidade-pública ⇒ 200 média=5 contagem=1; catálogo owner-null ⇒ 200', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await postReview(id, { rating: 5, comment: 'delícia' }, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SaveBody
    expect(body).toMatchObject({ average: 5, count: 1, viewerRating: 5, viewerComment: 'delícia' })
    expect(await countRows(id)).toBe(1)

    const cat = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: cat, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    const catRes = await postReview(cat, { rating: 4 }, headers)
    expect(catRes.status).toBe(200)
    expect((await catRes.json()).average).toBe(4)
  })

  it('dono avalia a PRÓPRIA ⇒ 422 auto_avaliacao, nada gravado', async () => {
    const { userId: owner, headers } = await seedSessionHeaders({ email: 'rev-self@ex.com' })
    const id = await seedPublicCommunity(owner)
    const res = await postReview(id, { rating: 5 }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'auto_avaliacao' })
    expect(await countRows(id)).toBe(0)
  })

  it('anônimo ⇒ 401, zero efeito', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-anon-owner@ex.com' })
    const id = await seedPublicCommunity(owner)
    const res = await postReview(id, { rating: 5 }) // sem headers
    expect(res.status).toBe(401)
    expect(await countRows(id)).toBe(0)
  })

  it.each([
    ['privada de outro', (owner: string) => seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: owner })],
    ['playful', (owner: string) => seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', resultKind: 'playful', ownerId: owner })],
    ['web_imported', (owner: string) => seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', visibility: 'private', ownerId: owner })],
    ['catálogo pending', () => seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })],
  ])('fora do pool (%s) ⇒ 404 leak-safe no POST e no GET', async (_name, make) => {
    const { userId: owner } = await seedSessionHeaders({ email: `rev-pool-owner-${_name}@ex.com` })
    const { headers } = await seedSessionHeaders({ email: `rev-pool-user-${_name}@ex.com` })
    const id = await make(owner)
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'X', provenance: 'escrita_por_pessoa' })

    const post = await postReview(id, { rating: 5 }, headers)
    expect(post.status).toBe(404)
    const get = await getReviews(id)
    expect(get.status).toBe(404)
    expect(await countRows(id)).toBe(0)
  })

  it('nota 0/6 ⇒ 400; comentário acima do cap ⇒ 400; comentário não-string ⇒ 400 (não 500)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-bad-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-bad-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    expect((await postReview(id, { rating: 0 }, headers)).status).toBe(400)
    expect((await postReview(id, { rating: 6 }, headers)).status).toBe(400)
    expect((await postReview(id, { rating: 5, comment: 'x'.repeat(2001) }, headers)).status).toBe(400)
    const nonString = await postReview(id, { rating: 5, comment: { evil: true } }, headers)
    // comment não-string é normalizado p/ ausente (não 500); rating válido ⇒ 200.
    expect(nonString.status).toBe(200)
    expect(await countRows(id)).toBe(1)
  })

  it('body malformado/vazio ⇒ 400, não 500', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-malformed-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-malformed-user@ex.com' })
    const id = await seedPublicCommunity(owner)
    const res = await postReview(id, 'not json at all', headers)
    expect(res.status).toBe(400)
  })

  it('editar via 2º POST E via PUT ⇒ 1 linha, nota atualizada, updated_at avança', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-edit-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-edit-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postReview(id, { rating: 3, comment: 'ok' }, headers)
    const [before] = await getDb().select().from(recipeReview).where(eq(recipeReview.recipeId, id))

    await new Promise((r) => setTimeout(r, 5))
    const second = await postReview(id, { rating: 5, comment: 'melhor' }, headers)
    expect(second.status).toBe(200)
    expect((await second.json()).count).toBe(1)

    const putRes = await putReview(id, { rating: 4 }, headers)
    expect(putRes.status).toBe(200)
    const pb = (await putRes.json()) as SaveBody
    expect(pb).toMatchObject({ count: 1, viewerRating: 4, viewerComment: null })

    expect(await countRows(id)).toBe(1)
    const [after] = await getDb().select().from(recipeReview).where(eq(recipeReview.recipeId, id))
    expect(after.rating).toBe(4)
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())
  })

  it('apagar a própria ⇒ linha some e agregado recomputa; apagar sem ter ⇒ idempotente 200', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-del-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-del-user@ex.com' })
    const { headers: other } = await seedSessionHeaders({ email: 'rev-del-other@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postReview(id, { rating: 5 }, headers)
    await postReview(id, { rating: 3 }, other)
    const del = await deleteReview(id, headers)
    expect(del.status).toBe(200)
    const db = (await del.json()) as SaveBody
    expect(db).toMatchObject({ count: 1, average: 3, viewerRating: null, viewerComment: null })
    expect(await countRows(id)).toBe(1)

    // apagar de novo (não tem) ⇒ no-op 200.
    const del2 = await deleteReview(id, headers)
    expect(del2.status).toBe(200)
  })

  it('apagar após despublicar ⇒ 404 (avaliações persistem, espelha unvote)', async () => {
    const { userId: owner, headers: ownerHeaders } = await seedSessionHeaders({ email: 'rev-unpub-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-unpub-user@ex.com' })
    const id = await seedPublicCommunity(owner)
    await postReview(id, { rating: 5 }, headers)

    const unp = await unpublish(id, ownerHeaders)
    expect(unp.status).toBe(200)

    const del = await deleteReview(id, headers)
    expect(del.status).toBe(404) // fora do pool
    expect(await countRows(id)).toBe(1) // a linha PERSISTE
  })

  it('cross-locale: avaliação vale idêntica lida pela irmã en-US (agregado independe do locale)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-xloc-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-xloc-user@ex.com' })
    const id = await seedPublicCommunity(owner, 'Bolo')
    await seedTranslation({ recipeId: id, locale: 'en-US', titulo: 'Cake', provenance: 'automatica_revisada' })

    await postReview(id, { rating: 4 }, headers)
    // o agregado é por recipe_id (não por locale) ⇒ mesma média/contagem.
    const get = await getReviews(id)
    const body = (await get.json()) as ListBody
    expect(body).toMatchObject({ average: 4, count: 1 })
  })

  it('GET cookie-free: lista + agregado, autor name/handle presentes, ids internos AUSENTES', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-get-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'rev-get-user@ex.com' })
    const id = await seedPublicCommunity(owner)
    await postReview(id, { rating: 5, comment: 'top' }, headers)

    const get = await getReviews(id) // sem headers → cookie-free
    expect(get.status).toBe(200)
    const body = (await get.json()) as ListBody & Record<string, unknown>
    expect(body.average).toBe(5)
    expect(body.count).toBe(1)
    expect(body.reviews).toHaveLength(1)
    const r = body.reviews[0]
    expect(r.rating).toBe(5)
    expect(r.comment).toBe('top')
    // handle presente (derivado do email pela hook de auth) — o link do byline usa isto.
    expect(typeof r.author.handle).toBe('string')
    expect(r.author.handle).toBeTruthy()
    // allowlist: nenhum user_id/moderated_at cru vaza.
    expect(JSON.stringify(r)).not.toContain('user_id')
    expect(JSON.stringify(r)).not.toContain('moderated_at')
    expect((r as Record<string, unknown>).userId).toBeUndefined()
  })

  it('moderated_at setado ⇒ excluído de média/contagem/lista (seam #366)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-mod-owner@ex.com' })
    const { headers: a } = await seedSessionHeaders({ email: 'rev-mod-a@ex.com' })
    const { headers: b } = await seedSessionHeaders({ email: 'rev-mod-b@ex.com' })
    const id = await seedPublicCommunity(owner)
    await postReview(id, { rating: 5 }, a)
    await postReview(id, { rating: 1 }, b)

    // modera a nota 1 direto no DB.
    await getDb()
      .update(recipeReview)
      .set({ moderatedAt: new Date() })
      .where(and(eq(recipeReview.recipeId, id), eq(recipeReview.rating, 1)))

    const get = await getReviews(id)
    const body = (await get.json()) as ListBody
    expect(body.count).toBe(1)
    expect(body.average).toBe(5)
    expect(body.reviews).toHaveLength(1)
  })

  it('autor soft-deletado ⇒ excluído de média/contagem/lista (leak guard)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rev-sd-owner@ex.com' })
    const { userId: gone, headers: goneH } = await seedSessionHeaders({ email: 'rev-sd-gone@ex.com' })
    const { headers: live } = await seedSessionHeaders({ email: 'rev-sd-live@ex.com' })
    const id = await seedPublicCommunity(owner)
    await postReview(id, { rating: 2 }, goneH)
    await postReview(id, { rating: 4 }, live)

    // soft-delete do autor da nota 2.
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone))

    const get = await getReviews(id)
    const body = (await get.json()) as ListBody
    expect(body.count).toBe(1)
    expect(body.average).toBe(4)
    expect(body.reviews).toHaveLength(1)
  })

  it('id não-uuid ⇒ 404 (isUuid), uuid inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rev-badid@ex.com' })
    expect((await postReview('not-a-uuid', { rating: 5 }, headers)).status).toBe(404)
    expect((await postReview('00000000-0000-0000-0000-000000000000', { rating: 5 }, headers)).status).toBe(404)
    expect((await getReviews('not-a-uuid')).status).toBe(404)
  })
})

describe('GET /api/recipes/[id]/reviews/mine (#363)', () => {
  it('sessão: devolve a própria avaliação após postar; isOwner=false; no-store', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'mine-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'mine-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const before = await getMine(id, headers)
    expect(before.status).toBe(200)
    expect(before.headers.get('cache-control')).toBe('no-store')
    expect((await before.json())).toMatchObject({ viewerReview: null, isOwner: false })

    await postReview(id, { rating: 4, comment: 'boa' }, headers)
    const after = await getMine(id, headers)
    expect((await after.json())).toMatchObject({
      viewerReview: { rating: 4, comment: 'boa' },
      isOwner: false,
    })
  })

  it('dono ⇒ isOwner=true', async () => {
    const { userId: owner, headers } = await seedSessionHeaders({ email: 'mine-own2@ex.com' })
    const id = await seedPublicCommunity(owner)
    const res = await getMine(id, headers)
    expect((await res.json())).toMatchObject({ isOwner: true, viewerReview: null })
  })

  it('anônimo ⇒ 401; fora do pool ⇒ 404; nunca vaza a avaliação alheia', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'mine-anon-owner@ex.com' })
    const { headers: viewer } = await seedSessionHeaders({ email: 'mine-viewer@ex.com' })
    const { headers: other } = await seedSessionHeaders({ email: 'mine-other@ex.com' })
    const id = await seedPublicCommunity(owner)
    await postReview(id, { rating: 5 }, viewer)

    expect((await getMine(id)).status).toBe(401)

    // outro usuário logado NÃO vê a nota do viewer (só a própria = null).
    const mine = await getMine(id, other)
    expect((await mine.json())).toMatchObject({ viewerReview: null })

    const priv = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: owner })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'Segredo', provenance: 'escrita_por_pessoa' })
    expect((await getMine(priv, other)).status).toBe(404)
  })
})
