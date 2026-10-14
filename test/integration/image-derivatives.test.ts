import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { getDb, setImageGenerator, setImageStore } from '@/server/deps'
import { FakeImageStore, type ImageStore, type StoreImageInput } from '@/server/images/image-store'
import { FakeImageGenerator } from '@/server/images/image-generator'
import {
  renderImageDerivatives,
  renderImageDerivativesSafe,
  storeImageDerivatives,
} from '@/server/images/image-derivatives'
import { backfillImageDerivatives } from '@/server/images/derivatives-backfill'
import { applyCatalogImageUpload } from '@/server/curate/catalog-image'
import { deleteOwnRecipe } from '@/server/recipe/owner-edit'
import { listMyRecipes } from '@/server/recipe/list-mine'
import { loadDiscoveryFeed } from '@/server/recipe/feed'
import { searchRecipes } from '@/server/recipe/search'
import { loadRecipeRows } from '@/server/recipe/load'
import { listPublicRecipesByOwner } from '@/server/recipe/list-public'
import { projectProfileRecipe } from '@/domain/recipe-profile-read'
import { projectResult } from '@/domain/recipe-search-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import { EMPTY_FACETS } from '@/domain/facet-params'
import { buildImageSrcSet } from '@/domain/image-variants'
import { recipe, recipeImage } from '@/db/schema'
import { POST as uploadRoute } from '@/app/api/recipes/[id]/image/route'
import { POST as generateRoute } from '@/app/api/recipes/[id]/image/generate/route'
import { DELETE as galleryDeleteRoute } from '@/app/api/recipes/[id]/images/[imageId]/route'
import { GET as cronGET } from '@/app/api/cron/image-derivatives/route'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Derivados WebP da Imagem da receita (achado I da auditoria de performance, migração 0077). Blob
 * sempre pelo `FakeImageStore` (nunca rede). Cobre:
 *  - o sharp: larguras 1280/400, WebP, sem ampliar, orientação EXIF aplicada, animada e lixo ⇒ sem derivado;
 *  - os 3 caminhos de escrita (upload do dono, upload do catálogo, geração por IA): original INTOCADO
 *    (bytes iguais), par de derivados gravado; falha nos derivados NUNCA falha a escrita (colunas NULL);
 *  - a imagem-a-imagem segue lendo o ORIGINAL (o PNG), não o WebP;
 *  - apagar da galeria / hard-delete da Receita apaga os derivados junto do original;
 *  - leitura: `imageSrcSet` no feed, Busca, Minhas criações, perfil e detalhe, sob o MESMO gate de
 *    moderação da foto; ausente sem derivados;
 *  - backfill: preenche, é idempotente, não destrói, prioriza faces, não passa fome com falha
 *    permanente, respeita lote/orçamento, descarta (e apaga) o par quando a linha muda no meio; cron fail-closed.
 */

let PNG: Buffer // "tipo Gemini": 1536×1024 (~2,5 MB; só pela geração, passa do teto de 2 MB do upload)
let UPLOAD_PNG: Buffer // 1200×800 (~1,5 MB, dentro do teto do upload)
let SMALL_PNG: Buffer // 300×200 (menor que os dois alvos)

/**
 * PNG "tipo Gemini" (foto de prato): textura fractal (`feTurbulence`) + 120 círculos com borda, ~2,5 MB em
 * PNG, como os ~1,5 MB do Gemini a 1024². O mesmo gerador mede o antes/depois no handoff 69.
 */
function plateSvg(width: number, height: number): Buffer {
  const circles = Array.from({ length: 120 }, (_, i) => {
    const fill = `rgb(${(i * 53) % 255},${(i * 91) % 200},${(i * 17) % 120})`
    const r = 10 + ((i * 37) % 120)
    return `<circle cx="${(i * 397) % width}" cy="${(i * 233) % height}" r="${r}" fill="${fill}" fill-opacity="0.6" stroke="#2a1a10" stroke-width="2"/>`
  }).join('')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="6" seed="3"/></filter>' +
      '<rect width="100%" height="100%" fill="#6b4a2f"/><rect width="100%" height="100%" filter="url(#n)" opacity="0.9"/>' +
      `${circles}</svg>`,
  )
}

beforeAll(async () => {
  PNG = await sharp(plateSvg(1536, 1024)).png().toBuffer()
  UPLOAD_PNG = await sharp(plateSvg(1200, 800)).png().toBuffer()
  SMALL_PNG = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c86432' } })
    .png()
    .toBuffer()
})

let store: FakeImageStore
beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
})

/** Store que falha só nos derivados (`recipes/w...`): o original sobe, os derivados não. */
class DerivativeFailingStore extends FakeImageStore {
  async store(input: StoreImageInput) {
    if (input.pathPrefix.startsWith('recipes/w')) throw new Error('blob fora (derivado)')
    return super.store(input)
  }
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const ctx2 = (id: string, imageId: string) => ({ params: Promise.resolve({ id, imageId }) })

function uploadReq(id: string, bytes: Buffer, headers: Headers): Request {
  const fd = new FormData()
  fd.append('file', new File([new Uint8Array(bytes)], 'p.png', { type: 'image/png' }))
  return new Request(`http://localhost/api/recipes/${id}/image`, { method: 'POST', body: fd, headers })
}
function genReq(id: string, headers: Headers, body?: Record<string, unknown>): Request {
  const h = new Headers(headers)
  if (body) h.set('content-type', 'application/json')
  return new Request(`http://localhost/api/recipes/${id}/image/generate`, {
    method: 'POST',
    headers: h,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

async function seedOwned(ownerId: string, opts: { visibility?: 'private' | 'public'; titulo?: string } = {}) {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    ownerId,
    visibility: opts.visibility ?? 'private',
    cozinha: 'brasileira',
  })
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: opts.titulo ?? 'Bolo de fubá',
    provenance: 'escrita_por_pessoa',
    slug: `bolo-${id.slice(0, 8)}`,
  })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'fubá', quantidade: '200', unidade: 'g' })
  return id
}

async function imageRow(imageId: string) {
  const [row] = await getDb().select().from(recipeImage).where(eq(recipeImage.id, imageId))
  return row
}
async function faceOf(recipeId: string): Promise<string | null> {
  const [r] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, recipeId))
  return r?.imageId ?? null
}

/** Guarda o original no Fake e cria a linha (sem derivados, como uma imagem anterior à 0077). */
async function seedLegacyImage(
  recipeId: string,
  opts: { bytes?: Buffer; face?: boolean; createdAt?: Date } = {},
): Promise<{ imageId: string; blobUrl: string }> {
  const { url } = await store.store({ data: opts.bytes ?? SMALL_PNG, contentType: 'image/png', pathPrefix: 'recipes' })
  const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, recipeId))
  const [img] = await getDb()
    .insert(recipeImage)
    .values({
      blobUrl: url,
      provenance: 'ai_generated',
      lineageId: r.lineageId,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: recipeImage.id })
  if (opts.face) await getDb().update(recipe).set({ imageId: img.id }).where(eq(recipe.id, recipeId))
  return { imageId: img.id, blobUrl: url }
}

describe('renderImageDerivatives (sharp)', () => {
  it('PNG de 1536×1024 ⇒ detail 1280 px e thumb 400 px, WebP, proporção mantida, muito menores', async () => {
    const r = await renderImageDerivatives(PNG)
    const d = await sharp(r.detail).metadata()
    const t = await sharp(r.thumb).metadata()
    expect([d.format, d.width, d.height]).toEqual(['webp', 1280, 853])
    expect([t.format, t.width, t.height]).toEqual(['webp', 400, 267])
    expect(PNG.length).toBeGreaterThan(1_500_000)
    expect(r.detail.length).toBeLessThan(PNG.length / 10)
    expect(r.thumb.length).toBeLessThan(PNG.length / 50)
  })

  it('original menor que os alvos NÃO é ampliado', async () => {
    const r = await renderImageDerivatives(SMALL_PNG)
    expect((await sharp(r.detail).metadata()).width).toBe(300)
    expect((await sharp(r.thumb).metadata()).width).toBe(300)
  })

  it('aplica a orientação EXIF (a tela mostra o original rotacionado; o WebP sai sem EXIF)', async () => {
    // 200×100 com Orientation=6 (90° horário): o navegador exibe 100×200.
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const r = await renderImageDerivatives(jpeg)
    const t = await sharp(r.thumb).metadata()
    expect([t.width, t.height]).toEqual([100, 200])
    expect(t.orientation).toBeUndefined()
  })

  it('imagem animada e bytes que não são imagem ⇒ sem derivado (null no caminho seguro)', async () => {
    const white = await sharp({ create: { width: 20, height: 40, channels: 4, background: '#fff' } }).png().toBuffer()
    const black = await sharp({ create: { width: 20, height: 40, channels: 4, background: '#000' } }).png().toBuffer()
    const animated = await sharp([white, black], { join: { animated: true } }).webp().toBuffer()
    expect((await sharp(animated).metadata()).pages).toBe(2)
    await expect(renderImageDerivatives(animated)).rejects.toThrow()
    expect(await renderImageDerivativesSafe(animated)).toBeNull()
    expect(await renderImageDerivativesSafe(Buffer.from([1, 2, 3, 4]))).toBeNull()
  })

  it('storeImageDerivatives: um put falhou ⇒ apaga o que subiu e devolve null (o par nunca fica pela metade)', async () => {
    const rendered = await renderImageDerivatives(SMALL_PNG)
    class HalfStore extends FakeImageStore {
      async store(input: StoreImageInput) {
        if (input.pathPrefix === 'recipes/w1280') throw new Error('fora')
        return super.store(input)
      }
    }
    const half = new HalfStore()
    expect(await storeImageDerivatives(half, rendered)).toBeNull()
    expect(half.blobs.size).toBe(0)
  })
})

describe('caminhos de escrita: derivados ao lado do original intocado', () => {
  it('upload do dono: original com os MESMOS bytes + par WebP; a view do detalhe traz o srcset', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dono@deriv.test' })
    const id = await seedOwned(userId)

    const res = await uploadRoute(uploadReq(id, UPLOAD_PNG, headers), ctx(id))
    expect(res.status).toBe(200)
    const view = (await res.json()) as { imageUrl?: string; imageSrcSet?: string }

    const img = await imageRow((await faceOf(id))!)
    expect(img.thumbUrl).toMatch(/\/recipes\/w400\/\d+\.webp$/)
    expect(img.detailUrl).toMatch(/\/recipes\/w1280\/\d+\.webp$/)
    expect(img.blobUrl).toMatch(/\/recipes\/\d+\.png$/)
    expect(Buffer.from(store.blobs.get(img.blobUrl)!.bytes).equals(UPLOAD_PNG)).toBe(true)
    expect(store.blobs.get(img.thumbUrl!)!.contentType).toBe('image/webp')
    expect(view.imageUrl).toBe(img.blobUrl)
    expect(view.imageSrcSet).toBe(buildImageSrcSet(img.thumbUrl, img.detailUrl))
  })

  it('upload do dono com o Blob dos derivados fora: 200, original guardado, colunas NULL, sem srcset', async () => {
    const failing = new DerivativeFailingStore()
    setImageStore(failing)
    const { userId, headers } = await seedSessionHeaders({ email: 'dono2@deriv.test' })
    const id = await seedOwned(userId)

    const res = await uploadRoute(uploadReq(id, UPLOAD_PNG, headers), ctx(id))
    expect(res.status).toBe(200)
    const view = (await res.json()) as { imageUrl?: string; imageSrcSet?: string }
    const img = await imageRow((await faceOf(id))!)
    expect([img.thumbUrl, img.detailUrl]).toEqual([null, null])
    expect(failing.blobs.size).toBe(1)
    expect(view.imageUrl).toBe(img.blobUrl)
    expect(view.imageSrcSet).toBeUndefined()
  })

  it('upload de bytes que o sharp não lê (aceitos pelo route como antes): 200, só o original', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dono3@deriv.test' })
    const id = await seedOwned(userId)
    const res = await uploadRoute(uploadReq(id, Buffer.from([1, 2, 3, 4]), headers), ctx(id))
    expect(res.status).toBe(200)
    const img = await imageRow((await faceOf(id))!)
    expect(img.thumbUrl).toBeNull()
    expect(store.blobs.size).toBe(1)
  })

  it('upload do catálogo (curador): original + par', async () => {
    const curator = await seedUser({ email: 'cur@deriv.test', role: 'curador' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Moqueca', provenance: 'automatica_nao_revisada' })

    const res = await applyCatalogImageUpload({
      db: getDb(),
      store,
      id,
      curatorId: curator,
      data: PNG,
      contentType: 'image/png',
    })
    expect(res.kind).toBe('ok')
    const img = await imageRow((await faceOf(id))!)
    expect(img.thumbUrl).not.toBeNull()
    expect(img.detailUrl).not.toBeNull()
    expect(Buffer.from(store.blobs.get(img.blobUrl)!.bytes).equals(PNG)).toBe(true)
    expect(res.kind === 'ok' && res.gallery[0].srcSet).toBe(buildImageSrcSet(img.thumbUrl, img.detailUrl))
  })

  it('geração por IA: PNG original + par; a edição imagem-a-imagem lê o ORIGINAL (PNG), não o WebP', async () => {
    const generator = new FakeImageGenerator({ data: PNG, contentType: 'image/png' })
    setImageGenerator(generator)
    const { userId, headers } = await seedSessionHeaders({ email: 'gen@deriv.test' })
    const id = await seedOwned(userId)

    const first = await generateRoute(genReq(id, headers), ctx(id))
    expect(first.status).toBe(200)
    const { image } = (await first.json()) as { image: { id: string; url: string; srcSet?: string } }
    const img = await imageRow(image.id)
    expect(img.blobUrl).toBe(image.url)
    expect(img.thumbUrl).not.toBeNull()
    expect(image.srcSet).toBe(buildImageSrcSet(img.thumbUrl, img.detailUrl))
    expect(Buffer.from(store.blobs.get(img.blobUrl)!.bytes).equals(PNG)).toBe(true)

    const edit = await generateRoute(genReq(id, headers, { prompt: 'mais luz', sourceImageId: image.id }), ctx(id))
    expect(edit.status).toBe(200)
    expect(generator.lastSource?.contentType).toBe('image/png')
    expect(generator.lastSource?.data.equals(PNG)).toBe(true)
  })

  it('geração com bytes que o sharp não lê: 200 e só o original (comportamento de antes)', async () => {
    setImageGenerator(new FakeImageGenerator())
    const { userId, headers } = await seedSessionHeaders({ email: 'gen2@deriv.test' })
    const id = await seedOwned(userId)
    const res = await generateRoute(genReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    expect(store.blobs.size).toBe(1)
  })
})

describe('apagar a imagem apaga os derivados', () => {
  it('APAGAR da galeria: original + 2 derivados somem do Blob', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del@deriv.test' })
    const id = await seedOwned(userId)
    await uploadRoute(uploadReq(id, UPLOAD_PNG, headers), ctx(id))
    await uploadRoute(uploadReq(id, SMALL_PNG, headers), ctx(id)) // a 2ª vira a face; a 1ª fica livre
    expect(store.blobs.size).toBe(6)
    const [first] = await getDb()
      .select({ id: recipeImage.id })
      .from(recipeImage)
      .where(sql`${recipeImage.id} <> ${(await faceOf(id))!}`)

    const res = await galleryDeleteRoute(
      new Request(`http://localhost/api/recipes/${id}/images/${first.id}`, { method: 'DELETE', headers }),
      ctx2(id, first.id),
    )
    expect(res.status).toBe(200)
    expect(store.blobs.size).toBe(3)
  })

  it('hard-delete da Receita (reap): original + derivados somem', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hard@deriv.test' })
    const id = await seedOwned(userId)
    await uploadRoute(uploadReq(id, UPLOAD_PNG, headers), ctx(id))
    expect(store.blobs.size).toBe(3)
    expect(await deleteOwnRecipe(getDb(), store, { recipeId: id, viewerId: userId })).toBe('ok')
    expect(store.blobs.size).toBe(0)
  })
})

describe('leitura: srcset nas superfícies, sob o gate de moderação da foto', () => {
  async function seedPublicWithDerivatives(ownerId: string) {
    const id = await seedOwned(ownerId, { visibility: 'public', titulo: 'Moqueca baiana' })
    const { imageId } = await seedLegacyImage(id, { face: true })
    await backfillImageDerivatives(getDb(), store)
    const img = await imageRow(imageId)
    return { id, imageId, srcSet: buildImageSrcSet(img.thumbUrl, img.detailUrl)! }
  }

  it('feed, Busca, Minhas criações, perfil e detalhe trazem o mesmo srcset; moderada ⇒ nada', async () => {
    const owner = await seedUser({ email: 'pub@deriv.test', handle: 'pubderiv' })
    const { id, imageId, srcSet } = await seedPublicWithDerivatives(owner)
    expect(srcSet).toBeDefined()

    const feed = await loadDiscoveryFeed(getDb(), { requestLocale: 'pt-BR' })
    expect(feed.feed.find((r) => r.recipeId === id)?.imageSrcSet).toBe(srcSet)

    const { hits } = await searchRecipes(getDb(), {
      q: 'Moqueca',
      terms: ['Moqueca'],
      mode: 'any',
      requestLocale: 'pt-BR',
      facets: EMPTY_FACETS,
      queryVector: null,
    })
    const hit = hits.find((h) => h.recipe_id === id)!
    expect(projectResult(hit, 'pt-BR')?.imageSrcSet).toBe(srcSet)

    const mine = await listMyRecipes(getDb(), { ownerId: owner, requestLocale: 'pt-BR', fallbackName: '—' })
    expect(mine[0].imageSrcSet).toBe(srcSet)

    const profile = await listPublicRecipesByOwner(getDb(), owner)
    expect(projectProfileRecipe(profile[0], 'pt-BR')?.imageSrcSet).toBe(srcSet)

    const rows = (await loadRecipeRows(getDb(), id))!
    expect(resolveRecipeView({ ...rows, requestLocale: 'pt-BR' }).imageSrcSet).toBe(srcSet)

    // Moderada: some do público junto com a foto; o dono segue vendo as duas.
    const curator = await seedUser({ email: 'mod@deriv.test', role: 'curador' })
    await getDb()
      .update(recipeImage)
      .set({ moderatedAt: new Date(), moderatedReason: 'teste', moderatedBy: curator })
      .where(eq(recipeImage.id, imageId))
    const feed2 = await loadDiscoveryFeed(getDb(), { requestLocale: 'pt-BR' })
    const item = feed2.feed.find((r) => r.recipeId === id)!
    expect([item.imageUrl, item.imageSrcSet]).toEqual([undefined, undefined])
    const rows2 = (await loadRecipeRows(getDb(), id))!
    const pub = resolveRecipeView({ ...rows2, requestLocale: 'pt-BR' })
    expect([pub.imageUrl, pub.imageSrcSet]).toEqual([undefined, undefined])
    const own = resolveRecipeView({ ...rows2, requestLocale: 'pt-BR', viewerId: owner })
    expect(own.imageSrcSet).toBe(srcSet)
    expect(
      (await listMyRecipes(getDb(), { ownerId: owner, requestLocale: 'pt-BR', fallbackName: '—' }))[0].imageSrcSet,
    ).toBeUndefined()
  })

  it('imagem sem derivados: imageUrl como antes e nenhum imageSrcSet', async () => {
    const owner = await seedUser({ email: 'nod@deriv.test' })
    const id = await seedOwned(owner, { visibility: 'public' })
    await seedLegacyImage(id, { face: true })
    const feed = await loadDiscoveryFeed(getDb(), { requestLocale: 'pt-BR' })
    const item = feed.feed.find((r) => r.recipeId === id)!
    expect(item.imageUrl).toBeDefined()
    expect('imageSrcSet' in item).toBe(false)
  })
})

describe('backfill dos derivados', () => {
  it('preenche, não toca o original e é idempotente (2ª passada não tenta nada)', async () => {
    const owner = await seedUser({ email: 'bf@deriv.test' })
    const id = await seedOwned(owner)
    const a = await seedLegacyImage(id, { face: true })
    const b = await seedLegacyImage(id)

    const r1 = await backfillImageDerivatives(getDb(), store)
    expect(r1).toEqual({ pendentes: 2, tentadas: 2, preenchidas: 2, falhas: 0, descartadas: 0 })
    for (const { imageId, blobUrl } of [a, b]) {
      const row = await imageRow(imageId)
      expect(row.blobUrl).toBe(blobUrl)
      expect(Buffer.from(store.blobs.get(blobUrl)!.bytes).equals(SMALL_PNG)).toBe(true)
      expect(row.thumbUrl).not.toBeNull()
      expect(row.detailUrl).not.toBeNull()
    }
    expect(store.blobs.size).toBe(6)

    const r2 = await backfillImageDerivatives(getDb(), store)
    expect(r2).toEqual({ pendentes: 0, tentadas: 0, preenchidas: 0, falhas: 0, descartadas: 0 })
    expect(store.blobs.size).toBe(6)
  })

  it('não sobrescreve derivados existentes e respeita o lote; faces primeiro', async () => {
    const owner = await seedUser({ email: 'bf2@deriv.test' })
    const id = await seedOwned(owner)
    const old = new Date('2026-01-01T00:00:00Z')
    const galleryOnly = await seedLegacyImage(id, { createdAt: old }) // mais antiga, mas não é face
    const face = await seedLegacyImage(id, { face: true })
    const done = await seedLegacyImage(id)
    await getDb()
      .update(recipeImage)
      .set({ thumbUrl: 'https://fake-blob.local/x/t.webp', detailUrl: 'https://fake-blob.local/x/d.webp' })
      .where(eq(recipeImage.id, done.imageId))

    const r = await backfillImageDerivatives(getDb(), store, { limit: 1 })
    expect(r).toMatchObject({ pendentes: 2, tentadas: 1, preenchidas: 1 })
    expect((await imageRow(face.imageId)).thumbUrl).not.toBeNull()
    expect((await imageRow(galleryOnly.imageId)).thumbUrl).toBeNull()
    expect((await imageRow(done.imageId)).thumbUrl).toBe('https://fake-blob.local/x/t.webp')
  })

  it('falha permanente vai para o fim da fila (sem fome) e conta em falhas', async () => {
    const owner = await seedUser({ email: 'bf3@deriv.test' })
    const id = await seedOwned(owner)
    const broken = await seedLegacyImage(id, { face: true, createdAt: new Date('2026-01-01T00:00:00Z') })
    store.blobs.delete(broken.blobUrl) // original sumiu do Blob
    const ok = await seedLegacyImage(id)

    const r1 = await backfillImageDerivatives(getDb(), store, { limit: 1 })
    expect(r1).toMatchObject({ tentadas: 1, falhas: 1, preenchidas: 0 })
    expect((await imageRow(broken.imageId)).derivativesAttemptedAt).toBeInstanceOf(Date)

    const r2 = await backfillImageDerivatives(getDb(), store, { limit: 1 })
    expect(r2).toMatchObject({ tentadas: 1, preenchidas: 1 })
    expect((await imageRow(ok.imageId)).thumbUrl).not.toBeNull()
    expect((await imageRow(broken.imageId)).thumbUrl).toBeNull()
  })

  it('URL que não é do nosso Blob não é buscada', async () => {
    const owner = await seedUser({ email: 'bf4@deriv.test' })
    const id = await seedOwned(owner)
    const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, id))
    await getDb()
      .insert(recipeImage)
      .values({ blobUrl: 'https://outro-host.example/a.png', provenance: 'user_photo', lineageId: r.lineageId })
    let gets = 0
    const spy: ImageStore = Object.assign(Object.create(store), {
      get: async (url: string) => {
        gets++
        return store.get(url)
      },
    })
    const res = await backfillImageDerivatives(getDb(), spy)
    expect(res).toMatchObject({ tentadas: 1, falhas: 1 })
    expect(gets).toBe(0)
  })

  it('orçamento de tempo esgotado: não começa imagem nova', async () => {
    const owner = await seedUser({ email: 'bf5@deriv.test' })
    const id = await seedOwned(owner)
    await seedLegacyImage(id)
    await seedLegacyImage(id)
    let t = 0
    const res = await backfillImageDerivatives(getDb(), store, { budgetMs: 10, clock: () => (t += 6) })
    expect(res).toMatchObject({ pendentes: 2, tentadas: 1 })
  })

  it('a linha foi preenchida no meio da passada: descarta e APAGA o par recém-gerado', async () => {
    const owner = await seedUser({ email: 'bf6@deriv.test' })
    const id = await seedOwned(owner)
    const img = await seedLegacyImage(id)
    // Store que, ao ler o original, simula outra passada preenchendo a linha antes do UPDATE desta.
    const racing: ImageStore = Object.assign(Object.create(store), {
      get: async (url: string) => {
        await getDb()
          .update(recipeImage)
          .set({ thumbUrl: 'https://fake-blob.local/o/t.webp', detailUrl: 'https://fake-blob.local/o/d.webp' })
          .where(eq(recipeImage.id, img.imageId))
        return store.get(url)
      },
    })
    const res = await backfillImageDerivatives(getDb(), racing)
    expect(res).toMatchObject({ tentadas: 1, descartadas: 1, preenchidas: 0 })
    expect((await imageRow(img.imageId)).thumbUrl).toBe('https://fake-blob.local/o/t.webp')
    expect(store.blobs.size).toBe(1) // só o original: o par desta passada foi apagado
  })

  it('o banco recusa um derivado sem o par (CHECK da 0077)', async () => {
    const owner = await seedUser({ email: 'bf7@deriv.test' })
    const id = await seedOwned(owner)
    const img = await seedLegacyImage(id)
    await expect(
      getDb().update(recipeImage).set({ thumbUrl: 'https://fake-blob.local/t.webp' }).where(eq(recipeImage.id, img.imageId)),
    ).rejects.toThrow()
  })
})

describe('GET /api/cron/image-derivatives', () => {
  const prev = process.env.CRON_SECRET
  beforeEach(() => {
    process.env.CRON_SECRET = 'segredo-teste'
    return () => {
      if (prev === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prev
    }
  })

  it('fail-closed: sem header ou com header errado ⇒ 401, nada roda', async () => {
    const owner = await seedUser({ email: 'cron@deriv.test' })
    const id = await seedOwned(owner)
    const img = await seedLegacyImage(id)
    expect((await cronGET(new Request('http://localhost/api/cron/image-derivatives'))).status).toBe(401)
    const wrong = new Request('http://localhost/api/cron/image-derivatives', { headers: { authorization: 'Bearer x' } })
    expect((await cronGET(wrong)).status).toBe(401)
    expect((await imageRow(img.imageId)).derivativesAttemptedAt).toBeNull()
  })

  it('com o Bearer certo: roda uma passada e devolve as contagens', async () => {
    const owner = await seedUser({ email: 'cron2@deriv.test' })
    const id = await seedOwned(owner)
    await seedLegacyImage(id)
    const res = await cronGET(
      new Request('http://localhost/api/cron/image-derivatives', { headers: { authorization: 'Bearer segredo-teste' } }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      pendentes: 1,
      tentadas: 1,
      preenchidas: 1,
      falhas: 0,
      descartadas: 0,
      restantes: 0,
    })
  })
})
