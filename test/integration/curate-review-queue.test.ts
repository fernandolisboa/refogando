import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET as listRoute } from '@/app/api/curate/review-images/route'
import { POST as removeRoute } from '@/app/api/curate/review-images/[imageId]/remove/route'
import { POST as dismissRoute } from '@/app/api/curate/review-images/[imageId]/dismiss/route'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { recipe, recipeImage } from '@/db/schema'
import { listReviewQueue } from '@/server/curate/review'
import { loadPublicRecipeBySlug } from '@/server/recipe/load'
import { resolveRecipeView } from '@/domain/recipe-read'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Fila PROATIVA do Curador (#227, ADR-0022 dec.3) — `GET /api/curate/review-images` +
 * `POST .../[imageId]/{remove,dismiss}`. Uma geração COM refino marca a imagem `review_required`;
 * a fila surfa as imagens `review_required AND moderated_at IS NULL` com contexto da receita
 * (título/owner/link via a LINHAGEM). NÃO-BLOQUEANTE (default-open INTACTO, ADR-0020): a imagem
 * segue pública até moderada. A fila encolhe por REMOVER (moderar #133 → some do público =
 * placeholder) OU DISPENSAR (zera a flag, imagem fica pública). Curador-gated (fail-closed).
 */

let store: FakeImageStore
beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
})

const ctx = (imageId: string) => ({ params: Promise.resolve({ imageId }) })

/**
 * Semeia uma recipe_image review_required (DESELECIONADA — geração-preview, #222) na linhagem de
 * uma receita do `owner`. A receita tem título (pt-BR) + slug. Devolve o id da imagem + da receita.
 */
async function seedReviewImage(input: {
  ownerId: string
  titulo?: string
  slug?: string
  visibility?: 'public' | 'private'
  blobUrl?: string
}): Promise<{ imageId: string; recipeId: string; lineageId: string }> {
  const recipeId = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    ownerId: input.ownerId,
    visibility: input.visibility ?? 'public',
  })
  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: input.titulo ?? 'Bolo refinado',
    provenance: 'automatica_nao_revisada',
    slug: input.slug ?? null,
  })
  const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, recipeId))
  const [img] = await getDb()
    .insert(recipeImage)
    .values({
      blobUrl: input.blobUrl ?? 'https://abc.public.blob.vercel-storage.com/recipes/refined.webp',
      provenance: 'ai_generated',
      lineageId: r.lineageId,
      createdBy: input.ownerId,
      reviewRequired: true,
    })
    .returning({ id: recipeImage.id })
  return { imageId: img.id, recipeId, lineageId: r.lineageId }
}

async function reviewRequiredOf(imageId: string): Promise<boolean> {
  const [r] = await getDb().select({ rr: recipeImage.reviewRequired }).from(recipeImage).where(eq(recipeImage.id, imageId))
  return r?.rr ?? false
}
async function moderatedAtOf(imageId: string): Promise<Date | null> {
  const [r] = await getDb().select({ at: recipeImage.moderatedAt }).from(recipeImage).where(eq(recipeImage.id, imageId))
  return r?.at ?? null
}

function listReq(headers?: Headers): Request {
  return new Request('http://localhost/api/curate/review-images', {
    method: 'GET',
    headers: headers ? Object.fromEntries(headers) : undefined,
  })
}
function removeReq(imageId: string, headers: Headers | undefined, reason?: string): Request {
  return new Request(`http://localhost/api/curate/review-images/${imageId}/remove`, {
    method: 'POST',
    headers: { ...(headers ? Object.fromEntries(headers) : {}), 'content-type': 'application/json' },
    body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
  })
}
function dismissReq(imageId: string, headers?: Headers): Request {
  return new Request(`http://localhost/api/curate/review-images/${imageId}/dismiss`, {
    method: 'POST',
    headers: headers ? Object.fromEntries(headers) : undefined,
  })
}

describe('listReviewQueue (núcleo) — contexto via linhagem', () => {
  it('lista as imagens review_required-e-não-moderadas com título + owner + recipeId', async () => {
    const owner = await seedUser({ email: 'dono@review.test', name: 'Dona Cozinha' })
    const { imageId, recipeId } = await seedReviewImage({ ownerId: owner, titulo: 'Risoto refinado' })

    const items = await listReviewQueue(getDb())
    const mine = items.find((i) => i.imageId === imageId)
    expect(mine).toBeDefined()
    expect(mine!.recipeId).toBe(recipeId)
    expect(mine!.recipeTitle).toBe('Risoto refinado')
    expect(mine!.ownerName).toBe('Dona Cozinha')
    expect(mine!.url).toContain('refined.webp')
  })

  it('NÃO lista imagens já moderadas (saíram da fila)', async () => {
    const curator = await seedUser({ email: 'cur@review.test', role: 'curador' })
    const owner = await seedUser({ email: 'mod@review.test' })
    const { imageId } = await seedReviewImage({ ownerId: owner })
    await getDb()
      .update(recipeImage)
      .set({ moderatedAt: new Date(), moderatedReason: 'já moderada', moderatedBy: curator })
      .where(eq(recipeImage.id, imageId))

    const items = await listReviewQueue(getDb())
    expect(items.find((i) => i.imageId === imageId)).toBeUndefined()
  })

  it('NÃO lista imagens sem review_required (geração sem refino)', async () => {
    const owner = await seedUser({ email: 'norr@review.test' })
    const { recipeId } = await seedReviewImage({ ownerId: owner })
    // Uma 2ª imagem na linhagem, SEM review_required.
    const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, recipeId))
    const [plain] = await getDb()
      .insert(recipeImage)
      .values({ blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/plain.webp', provenance: 'ai_generated', lineageId: r.lineageId, createdBy: owner, reviewRequired: false })
      .returning({ id: recipeImage.id })

    const items = await listReviewQueue(getDb())
    expect(items.find((i) => i.imageId === plain.id)).toBeUndefined()
  })
})

describe('GET /api/curate/review-images — gating + listagem', () => {
  it('anon → 401', async () => {
    const res = await listRoute(listReq())
    expect(res.status).toBe(401)
  })

  it('usuario → 403 (fail-closed)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'user@review.test' }) // role usuario
    const res = await listRoute(listReq(headers))
    expect(res.status).toBe(403)
  })

  it('curador → 200 com { images: [...] }', async () => {
    const { headers } = await seedSessionHeaders({ email: 'curador@review.test', role: 'curador' })
    const owner = await seedUser({ email: 'autor@review.test' })
    const { imageId } = await seedReviewImage({ ownerId: owner })

    const res = await listRoute(listReq(headers))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { images: { imageId: string }[] }
    expect(body.images.some((i) => i.imageId === imageId)).toBe(true)
  })
})

describe('POST /api/curate/review-images/[imageId]/remove — modera + sai da fila', () => {
  it('curador remove com motivo: 200, modera a imagem (some do público = placeholder), e cai da fila', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rem@review.test', role: 'curador' })
    const owner = await seedUser({ email: 'face@review.test' })
    const { imageId, recipeId } = await seedReviewImage({ ownerId: owner, slug: 'risoto-refinado', visibility: 'public' })
    // A imagem refinada vira a face pública (default-open: review_required não bloqueia).
    await getDb().update(recipe).set({ imageId }).where(eq(recipe.id, recipeId))

    const res = await removeRoute(removeReq(imageId, headers, 'imagem abusiva'), ctx(imageId))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })

    // Moderada (moderated_at setado) ⇒ saiu da fila.
    expect(await moderatedAtOf(imageId)).not.toBeNull()
    const items = await listReviewQueue(getDb())
    expect(items.find((i) => i.imageId === imageId)).toBeUndefined()

    // Público (leitor anônimo) perde a face (placeholder) — gate do #133/#225.
    const rows = await loadPublicRecipeBySlug(getDb(), 'risoto-refinado', 'pt-BR')
    expect(rows).not.toBeNull()
    const view = resolveRecipeView({ ...rows!, requestLocale: 'pt-BR' })
    expect(view.imageUrl).toBeUndefined() // moderada ⇒ escondida do público
  })

  it('motivo vazio → 400; a imagem NÃO é moderada (continua na fila)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rem2@review.test', role: 'curador' })
    const owner = await seedUser({ email: 'semrazao@review.test' })
    const { imageId } = await seedReviewImage({ ownerId: owner })

    const res = await removeRoute(removeReq(imageId, headers, '   '), ctx(imageId))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    expect(await moderatedAtOf(imageId)).toBeNull()
    expect(await reviewRequiredOf(imageId)).toBe(true) // segue na fila
  })

  it('imagem inexistente → 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rem3@review.test', role: 'curador' })
    const res = await removeRoute(
      removeReq('00000000-0000-0000-0000-000000000000', headers, 'motivo'),
      ctx('00000000-0000-0000-0000-000000000000'),
    )
    expect(res.status).toBe(404)
  })

  it('uuid inválido → 404 (não toca o banco)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'rem4@review.test', role: 'curador' })
    const res = await removeRoute(removeReq('nao-uuid', headers, 'motivo'), ctx('nao-uuid'))
    expect(res.status).toBe(404)
  })

  it('anon → 401; usuario → 403 (fail-closed) ANTES de tocar a imagem', async () => {
    const owner = await seedUser({ email: 'gate@review.test' })
    const { imageId } = await seedReviewImage({ ownerId: owner })

    const anon = await removeRoute(removeReq(imageId, undefined, 'motivo'), ctx(imageId))
    expect(anon.status).toBe(401)

    const { headers } = await seedSessionHeaders({ email: 'plebe@review.test' }) // usuario
    const forbidden = await removeRoute(removeReq(imageId, headers, 'motivo'), ctx(imageId))
    expect(forbidden.status).toBe(403)
    expect(await moderatedAtOf(imageId)).toBeNull() // não moderou
  })

  it('re-remover (já moderada) → 200 ok (idempotente, preserva a 1ª proveniência)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'reremove@review.test', role: 'curador' })
    const owner = await seedUser({ email: 'dupla@review.test' })
    const { imageId } = await seedReviewImage({ ownerId: owner })

    const first = await removeRoute(removeReq(imageId, headers, 'motivo 1'), ctx(imageId))
    expect(first.status).toBe(200)
    const at1 = await moderatedAtOf(imageId)

    const second = await removeRoute(removeReq(imageId, headers, 'motivo 2'), ctx(imageId))
    expect(second.status).toBe(200)
    // A 1ª proveniência é preservada (não sobrescreve o moderated_at).
    expect((await moderatedAtOf(imageId))!.getTime()).toBe(at1!.getTime())
  })
})

describe('POST /api/curate/review-images/[imageId]/dismiss — zera a flag + sai da fila, imagem fica pública', () => {
  it('curador dispensa: 200, zera review_required, NÃO modera, e cai da fila', async () => {
    const { headers } = await seedSessionHeaders({ email: 'dism@review.test', role: 'curador' })
    const owner = await seedUser({ email: 'ok@review.test' })
    const { imageId, recipeId } = await seedReviewImage({ ownerId: owner, slug: 'bolo-ok', visibility: 'public' })
    await getDb().update(recipe).set({ imageId }).where(eq(recipe.id, recipeId))

    const res = await dismissRoute(dismissReq(imageId, headers), ctx(imageId))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })

    expect(await reviewRequiredOf(imageId)).toBe(false) // flag zerada
    expect(await moderatedAtOf(imageId)).toBeNull() // NÃO moderada
    const items = await listReviewQueue(getDb())
    expect(items.find((i) => i.imageId === imageId)).toBeUndefined() // saiu da fila

    // A imagem permanece PÚBLICA (dispensar ≠ moderar) — a face segue visível ao anônimo.
    const rows = await loadPublicRecipeBySlug(getDb(), 'bolo-ok', 'pt-BR')
    const view = resolveRecipeView({ ...rows!, requestLocale: 'pt-BR' })
    expect(view.imageUrl).toContain('refined.webp')
  })

  it('imagem inexistente → 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'dism2@review.test', role: 'curador' })
    const res = await dismissRoute(
      dismissReq('00000000-0000-0000-0000-000000000000', headers),
      ctx('00000000-0000-0000-0000-000000000000'),
    )
    expect(res.status).toBe(404)
  })

  it('anon → 401; usuario → 403 (fail-closed) ANTES de tocar a flag', async () => {
    const owner = await seedUser({ email: 'gate2@review.test' })
    const { imageId } = await seedReviewImage({ ownerId: owner })

    const anon = await dismissRoute(dismissReq(imageId), ctx(imageId))
    expect(anon.status).toBe(401)

    const { headers } = await seedSessionHeaders({ email: 'plebe2@review.test' })
    const forbidden = await dismissRoute(dismissReq(imageId, headers), ctx(imageId))
    expect(forbidden.status).toBe(403)
    expect(await reviewRequiredOf(imageId)).toBe(true) // não zerou
  })
})
