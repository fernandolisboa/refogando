import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import sharp from 'sharp'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore, ThrowingImageStore } from '@/server/images/image-store'
import { recipeImage, recipeReview, users } from '@/db/schema'
import {
  POST as reviewPost,
  PUT as reviewPut,
  DELETE as reviewDelete,
  GET as reviewGet,
} from '@/app/api/recipes/[id]/reviews/route'
import { GET as mineGet } from '@/app/api/recipes/[id]/reviews/mine/route'
import { POST as unpublishRoute } from '@/app/api/recipes/[id]/unpublish/route'
import { applyReview } from '@/server/recipe/review'
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

    // modera a nota 1 direto no DB (moderatedAt + moderatedBy juntos — o CHECK de consistência
    // `(moderated_at IS NULL) = (moderated_by IS NULL)` exige os dois; qualquer user vivo serve de curador).
    await getDb()
      .update(recipeReview)
      .set({ moderatedAt: new Date(), moderatedBy: owner })
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

// ── #365: FOTO da avaliação (upload/câmera, SEM IA) ───────────────────────────────
describe('POST/DELETE /api/recipes/[id]/reviews — foto (#365, ADR-0027)', () => {
  let store: FakeImageStore
  beforeEach(() => {
    // O beforeEach global (setup.ts) já rodou resetDeps(); injetamos um Fake fresco por teste
    // (espelha me-avatar) pra NUNCA tocar a rede e poder inspecionar `.blobs`.
    store = new FakeImageStore()
    setImageStore(store)
  })

  /** Imagem REAL e pequena (sharp decodifica) — o border re-encoda via sharp (strip de EXIF). */
  async function realImageFile(name = 'prato.png', type: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/png'): Promise<File> {
    const base = sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 60, b: 40 } } })
    const buf =
      type === 'image/jpeg' ? await base.jpeg().toBuffer() : type === 'image/webp' ? await base.webp().toBuffer() : await base.png().toBuffer()
    return new File([new Uint8Array(buf)], name, { type })
  }

  /** PNG cor-sólida de dimensão arbitrária (F1: bomba de pixels vs. imagem legítima grande). Cor
   * sólida comprime MUITO, então mesmo 5000×5000 fica bem abaixo do cap de 2 MB de BYTES. */
  async function solidPngFile(width: number, height: number, name: string): Promise<File> {
    const buf = await sharp({ create: { width, height, channels: 3, background: { r: 120, g: 80, b: 40 } } })
      .png()
      .toBuffer()
    return new File([new Uint8Array(buf)], name, { type: 'image/png' })
  }

  /** Invoca o POST com corpo multipart (espelha me-avatar `postReq`). O Request seta o boundary. */
  function postMultipart(
    id: string,
    fields: { rating?: number | string; comment?: string; file?: File; removePhoto?: string },
    headers?: Headers,
  ): Promise<Response> {
    const fd = new FormData()
    if (fields.rating !== undefined) fd.append('rating', String(fields.rating))
    if (fields.comment !== undefined) fd.append('comment', fields.comment)
    if (fields.file) fd.append('file', fields.file)
    if (fields.removePhoto !== undefined) fd.append('removePhoto', fields.removePhoto)
    return reviewPost(new Request(`http://localhost/api/recipes/${id}/reviews`, { method: 'POST', body: fd, headers }), {
      params: Promise.resolve({ id }),
    })
  }

  async function photoUrlOf(id: string, userId: string): Promise<string | null> {
    const [row] = await getDb()
      .select({ photoUrl: recipeReview.photoUrl })
      .from(recipeReview)
      .where(and(eq(recipeReview.recipeId, id), eq(recipeReview.userId, userId)))
    return row?.photoUrl ?? null
  }
  async function countRecipeImages(): Promise<number> {
    const [row] = await getDb().select({ n: dsql<number>`count(*)::int` }).from(recipeImage)
    return row?.n ?? 0
  }

  it('anexa foto ao CRIAR ⇒ photo_url gravado, blob guardado (webp), review pública mostra a foto', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-create-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-create-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await postMultipart(id, { rating: 5, comment: 'ficou lindo', file: await realImageFile() }, headers)
    expect(res.status).toBe(200)

    const url = await photoUrlOf(id, uid)
    expect(url).toBeTruthy()
    expect(store.owns(url!)).toBe(true)
    expect(store.blobs.has(url!)).toBe(true)
    // C1: os bytes armazenados são o WEBP re-encodado pelo sharp (não os bytes crus enviados).
    expect(store.blobs.get(url!)!.contentType).toBe('image/webp')

    // a review PÚBLICA (GET cookie-free) expõe a foto.
    const get = await getReviews(id)
    const body = (await get.json()) as ListBody & { reviews: { photoUrl: string | null }[] }
    expect(body.reviews[0].photoUrl).toBe(url)
  })

  it('editar TROCANDO a foto ⇒ blob antigo apagado, novo presente, photo_url = novo', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-swap-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-swap-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postMultipart(id, { rating: 4, file: await realImageFile('a.png') }, headers)
    const first = await photoUrlOf(id, uid)
    expect(store.blobs.has(first!)).toBe(true)

    const res = await postMultipart(id, { rating: 5, file: await realImageFile('b.png') }, headers)
    expect(res.status).toBe(200)
    const second = await photoUrlOf(id, uid)

    expect(second).not.toBe(first)
    expect(store.blobs.has(first!)).toBe(false) // antigo apagado (superseded)
    expect(store.blobs.has(second!)).toBe(true) // novo presente
  })

  it('editar REMOVENDO a foto (removePhoto) ⇒ photo_url null, blob antigo apagado', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-rm-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-rm-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postMultipart(id, { rating: 4, file: await realImageFile() }, headers)
    const url = await photoUrlOf(id, uid)
    expect(store.blobs.has(url!)).toBe(true)

    const res = await postMultipart(id, { rating: 4, removePhoto: '1' }, headers)
    expect(res.status).toBe(200)
    expect(await photoUrlOf(id, uid)).toBeNull()
    expect(store.blobs.has(url!)).toBe(false)
  })

  it('editar SEM tocar a foto (keep, JSON) ⇒ mantém a foto existente', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-keep-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-keep-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postMultipart(id, { rating: 4, file: await realImageFile() }, headers)
    const url = await photoUrlOf(id, uid)

    // edição via JSON (sem foto) NÃO mexe na photo_url (keep).
    const res = await postReview(id, { rating: 2, comment: 'mudei a nota' }, headers)
    expect(res.status).toBe(200)
    expect(await photoUrlOf(id, uid)).toBe(url)
    expect(store.blobs.has(url!)).toBe(true)
  })

  it('APAGAR review com foto ⇒ blob apagado', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-del-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-del-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postMultipart(id, { rating: 5, file: await realImageFile() }, headers)
    const url = await photoUrlOf(id, uid)
    expect(store.blobs.has(url!)).toBe(true)

    const del = await deleteReview(id, headers)
    expect(del.status).toBe(200)
    expect(store.blobs.has(url!)).toBe(false)
    expect(await countRows(id)).toBe(0)
  })

  it('APAGAR review MODERADA (no-op) ⇒ blob NÃO apagado (foto persiste oculta)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-moddel-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-moddel-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    await postMultipart(id, { rating: 5, file: await realImageFile() }, headers)
    const url = await photoUrlOf(id, uid)

    // modera a linha direto no DB (moderatedAt + moderatedBy juntos — CHECK de consistência).
    await getDb()
      .update(recipeReview)
      .set({ moderatedAt: new Date(), moderatedBy: owner })
      .where(and(eq(recipeReview.recipeId, id), eq(recipeReview.userId, uid)))

    const del = await deleteReview(id, headers)
    expect(del.status).toBe(200)
    // M4: delete de moderada é no-op ⇒ deletedPhotoUrl null ⇒ o blob PERSISTE.
    expect(store.blobs.has(url!)).toBe(true)
    expect(await countRows(id)).toBe(1) // a linha (moderada) persiste
  })

  it('tipo inválido ⇒ 400 tipo_invalido, nada armazenado, nada gravado', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-tipo-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'foto-tipo-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const bad = new File(['oi'], 'a.txt', { type: 'text/plain' })
    const res = await postMultipart(id, { rating: 5, file: bad }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await countRows(id)).toBe(0)
  })

  it('bytes não-decodificáveis (type forjado) ⇒ 400 tipo_invalido (sharp recusa), nada armazenado', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-garbage-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'foto-garbage-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const forged = new File([new Uint8Array([1, 2, 3, 4])], 'x.png', { type: 'image/png' })
    const res = await postMultipart(id, { rating: 5, file: forged }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await countRows(id)).toBe(0)
  })

  it('acima de 2MB ⇒ 400 arquivo_grande (checado ANTES de ler os bytes)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-grande-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'foto-grande-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const tooBig = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' })
    const res = await postMultipart(id, { rating: 5, file: tooBig }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'arquivo_grande' })
    expect(store.blobs.size).toBe(0)
    expect(await countRows(id)).toBe(0)
  })

  it('storage indisponível ⇒ 503 storage_indisponivel, avaliação NÃO criada', async () => {
    setImageStore(new ThrowingImageStore())
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-503-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'foto-503-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await postMultipart(id, { rating: 5, file: await realImageFile() }, headers)
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: 'storage_indisponivel' })
    // store falha ANTES do upsert ⇒ a avaliação não existe (nada parcial).
    expect(await countRows(id)).toBe(0)
  })

  it('GATE antes do STORE: auto-avaliação COM foto ⇒ 422 e NENHUM blob guardado', async () => {
    const { userId: owner, headers } = await seedSessionHeaders({ email: 'foto-gate-owner@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await postMultipart(id, { rating: 5, file: await realImageFile() }, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'auto_avaliacao' })
    // C2: o store roda DEPOIS do gate+decideReview ⇒ save rejeitado nunca queima o storage.
    expect(store.blobs.size).toBe(0)
    expect(await countRows(id)).toBe(0)
  })

  it('anexar foto NÃO cria linha em recipe_image (só o cano de blob; sem IA/lineage)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-noimg-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'foto-noimg-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const before = await countRecipeImages()
    const res = await postMultipart(id, { rating: 5, file: await realImageFile() }, headers)
    expect(res.status).toBe(200)
    expect(await countRecipeImages()).toBe(before) // NENHUMA entidade recipe_image tocada
  })

  it('F1: PNG 5000×5000 (25 MP, bomba de descompressão) ⇒ 400 tipo_invalido, nada armazenado/gravado', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-bomb-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'foto-bomb-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    // 5000×5000 = 25 MP (> limite de 24 MP), mas cor sólida comprime p/ ~0,33 MB ⇒ PASSA o cap de
    // BYTES (2 MB). Sem clamp de PIXELS, o decode explode p/ ~750 MB RGBA e OOMa a função (1024 MB
    // na Vercel). `limitInputPixels: 24_000_000` faz o sharp LANÇAR ⇒ o catch mapeia p/ 400, não 500.
    const bomb = await solidPngFile(5000, 5000, 'bomb.png')
    expect(bomb.size).toBeLessThan(2 * 1024 * 1024) // passa o cap de bytes (o clamp de pixels é o que barra)
    const res = await postMultipart(id, { rating: 5, file: bomb }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await countRows(id)).toBe(0)
  })

  it('F1: imagem legítima grande (3000×2000) ⇒ 200 e blob GRAVADO com dimensão ≤2048', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-resize-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-resize-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    // 3000×2000 = 6 MP (sob o limite): ACEITA, mas o `.resize(fit:inside, withoutEnlargement)` LIMITA
    // a dimensão do blob gravado a 2048 mesmo se o cliente for burlado (o servidor é o backstop).
    const big = await solidPngFile(3000, 2000, 'big.png')
    expect(big.size).toBeLessThan(2 * 1024 * 1024)
    const res = await postMultipart(id, { rating: 5, file: big }, headers)
    expect(res.status).toBe(200)

    const url = await photoUrlOf(id, uid)
    const blob = store.blobs.get(url!)!
    const meta = await sharp(Buffer.from(blob.bytes)).metadata()
    expect(meta.width!).toBeLessThanOrEqual(2048)
    expect(meta.height!).toBeLessThanOrEqual(2048)
  })

  it('C1/F2: EXIF/GPS é REMOVIDO no re-encode ⇒ o blob gravado NÃO carrega metadata (não vaza local)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-exif-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-exif-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    // Entrada JPEG COM EXIF (Copyright) + GPS (lat/long): se o servidor um dia adicionasse
    // `.withMetadata()` por regressão, o GPS SOBREVIVERIA na foto pública. Sanidade abaixo prova que a
    // entrada de fato carrega EXIF ⇒ o teste é significativo (não passa vacuamente).
    const exifBuf = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      // IFD3 é a GPS IFD no libvips/sharp (o "GPS" tag group). Copyright em IFD0 + lat/long em IFD3.
      .withExif({ IFD0: { Copyright: 'x' }, IFD3: { GPSLatitude: '10/1 0/1 0/1', GPSLongitude: '20/1 0/1 0/1' } })
      .jpeg()
      .toBuffer()
    expect((await sharp(exifBuf).metadata()).exif).toBeDefined()
    const withExifFile = new File([new Uint8Array(exifBuf)], 'gps.jpg', { type: 'image/jpeg' })

    const res = await postMultipart(id, { rating: 5, file: withExifFile }, headers)
    expect(res.status).toBe(200)

    const url = await photoUrlOf(id, uid)
    const blob = store.blobs.get(url!)!
    const meta = await sharp(Buffer.from(blob.bytes)).metadata()
    expect(meta.exif).toBeUndefined() // nenhum EXIF/GPS sobrevive ao re-encode (pin do C1)
  })

  it('caminho JSON sem foto continua funcionando (regressão) ⇒ photo_url null', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'foto-json-owner@ex.com' })
    const { userId: uid, headers } = await seedSessionHeaders({ email: 'foto-json-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await postReview(id, { rating: 4, comment: 'sem foto' }, headers)
    expect(res.status).toBe(200)
    expect(await photoUrlOf(id, uid)).toBeNull()

    const get = await getReviews(id)
    const body = (await get.json()) as ListBody & { reviews: { photoUrl: string | null }[] }
    expect(body.reviews[0].photoUrl).toBeNull()
  })
})

// ── #F3: reap do blob órfão quando o upsert falha DEPOIS de um store bem-sucedido ─────────────
describe('applyReview — órfão de blob reapado quando o upsert lança (#365 C4/#F3)', () => {
  it('store OK mas upsert LANÇA ⇒ rejeita, blob reapado (best-effort), nenhuma linha persiste', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'orphan-owner@ex.com' })
    const { userId: uid } = await seedSessionHeaders({ email: 'orphan-user@ex.com' })
    const id = await seedPublicCommunity(owner)

    const fakeStore = new FakeImageStore()
    // Proxy que LANÇA só em `insert` (o upsert) e delega TODO o resto ao DB real — assim o gate de
    // pool, o decideReview e o SELECT-prévio da foto rodam de verdade, o store guarda o blob, e só o
    // upsert dispara o catch de reap. Espelha "o DB caiu DEPOIS de o store ter gravado o blob".
    const throwingDb = new Proxy(getDb(), {
      get(t, p, r) {
        if (p === 'insert')
          return () => {
            throw new Error('boom-upsert')
          }
        return Reflect.get(t, p, r)
      },
    })

    const clean = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
      .webp()
      .toBuffer()
    await expect(
      applyReview({
        db: throwingDb,
        store: fakeStore,
        id,
        userId: uid,
        action: 'save',
        rating: 5,
        comment: 'x',
        photo: { kind: 'set', data: Buffer.from(clean), contentType: 'image/webp' },
      }),
    ).rejects.toThrow('boom-upsert')

    expect(fakeStore.blobs.size).toBe(0) // o blob recém-gravado foi reapado no catch (não vira órfão)
    expect(await countRows(id)).toBe(0) // nada persistiu
  })
})
