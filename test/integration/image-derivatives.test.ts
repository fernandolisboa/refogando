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
import { applyCatalogGalleryImageDelete, applyCatalogImageUpload } from '@/server/curate/catalog-image'
import { deleteOwnRecipe } from '@/server/recipe/owner-edit'
import { operatorEscalateSource } from '@/server/recipe/operator-clear-attribution'
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
 *  - o sharp: larguras 1280/400, WebP, sem ampliar, orientação EXIF aplicada; animada, lixo e formato fora
 *    de JPEG/PNG/WebP (SVG rotulado png, GIF, TIFF) ⇒ sem derivado, sem renderizar;
 *  - os 3 caminhos de escrita (upload do dono, upload do catálogo, geração por IA): par de derivados
 *    gravado ao lado do original; falha nos derivados NUNCA falha a escrita (colunas NULL). O original do
 *    UPLOAD é o WebP re-encodado (#596: sem EXIF, ≤2048 px; bytes que não são imagem ⇒ 400 sem nada
 *    guardado); o da GERAÇÃO é o PNG do Gemini intocado (bytes iguais);
 *  - a imagem-a-imagem lê o ORIGINAL: o PNG gerado, ou o WebP re-encodado de uma foto enviada;
 *  - apagar da galeria (dono e catálogo) / hard-delete da Receita / escalada do operador apaga os
 *    derivados junto do original;
 *  - leitura: `imageSrcSet` no feed, Busca, Minhas criações, perfil e detalhe, sob o MESMO gate de
 *    moderação da foto; ausente sem derivados;
 *  - backfill: preenche, é idempotente, não destrói, prioriza as selecionadas, tira da fila por 7 dias
 *    a falha permanente e a imagem moderada, respeita lote/orçamento/reserva, descarta (e apaga) o par
 *    quando a linha muda no meio; cron fail-closed.
 */

let PNG: Buffer // "tipo Gemini": 1536×1024 (~2,5 MB; só pela geração, passa do teto de 2 MB do upload)
let UPLOAD_PNG: Buffer // 1200×800 (~1,5 MB, dentro do teto do upload)
let SMALL_PNG: Buffer // 300×200 (menor que os dois alvos)

/**
 * SVG pequeno com filtros caros (`feTurbulence` + `feGaussianBlur` numa tela grande): o sharp o
 * renderizaria se o deixássemos (um parecido custou ~30 s de CPU). Só serve se o formato for barrado
 * ANTES de decodificar.
 */
const HEAVY_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4800" height="4800">' +
    '<filter id="f"><feTurbulence baseFrequency="0.9" numOctaves="10"/><feGaussianBlur stdDeviation="40"/>' +
    '<feGaussianBlur stdDeviation="80"/></filter><rect width="100%" height="100%" filter="url(#f)"/></svg>',
)

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
  it('PNG de 1536×1024 ⇒ detail 1280 px e thumb 400 px, WebP, proporção mantida, thumb < detail < original', async () => {
    const r = await renderImageDerivatives(PNG)
    const d = await sharp(r.detail).metadata()
    const t = await sharp(r.thumb).metadata()
    expect([d.format, d.width, d.height]).toEqual(['webp', 1280, 853])
    expect([t.format, t.width, t.height]).toEqual(['webp', 400, 267])
    expect(r.thumb.length).toBeLessThan(r.detail.length)
    expect(r.detail.length).toBeLessThan(PNG.length)
  })

  it('JPEG e WebP (os outros formatos aceitos pelo upload) também ganham derivados', async () => {
    for (const bytes of [await sharp(UPLOAD_PNG).jpeg().toBuffer(), await sharp(UPLOAD_PNG).webp().toBuffer()]) {
      const r = await renderImageDerivatives(bytes)
      expect((await sharp(r.detail).metadata()).width).toBe(1200)
      expect((await sharp(r.thumb).metadata()).width).toBe(400)
    }
  })

  it('SVG rotulado image/png (filtros caros) ⇒ sem derivado, sem renderizar: termina rápido', async () => {
    const t0 = performance.now()
    expect(await renderImageDerivativesSafe(HEAVY_SVG)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(1_000)
    await expect(renderImageDerivatives(HEAVY_SVG)).rejects.toThrow(/formato svg/)
  })

  it('GIF e TIFF (o sharp decodifica, mas não são JPEG/PNG/WebP) ⇒ sem derivado', async () => {
    const base = sharp({ create: { width: 40, height: 20, channels: 3, background: '#c86432' } })
    for (const bytes of [await base.clone().gif().toBuffer(), await base.clone().tiff().toBuffer()]) {
      expect(await renderImageDerivativesSafe(bytes)).toBeNull()
    }
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

describe('caminhos de escrita: derivados ao lado do original (o do upload, re-encodado — #596)', () => {
  it('upload do dono: original re-encodado em WebP (sem EXIF, mesma largura) + par WebP; a view traz o srcset', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dono@deriv.test' })
    const id = await seedOwned(userId)

    const res = await uploadRoute(uploadReq(id, UPLOAD_PNG, headers), ctx(id))
    expect(res.status).toBe(200)
    const view = (await res.json()) as { imageUrl?: string; imageSrcSet?: string }

    const img = await imageRow((await faceOf(id))!)
    expect(img.thumbUrl).toMatch(/\/recipes\/w400\/\d+\.webp$/)
    expect(img.detailUrl).toMatch(/\/recipes\/w1280\/\d+\.webp$/)
    expect(img.blobUrl).toMatch(/\/recipes\/\d+\.webp$/)
    const original = store.blobs.get(img.blobUrl)!
    expect(original.contentType).toBe('image/webp')
    const meta = await sharp(Buffer.from(original.bytes)).metadata()
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['webp', 1200, 800, undefined])
    expect(store.blobs.get(img.thumbUrl!)!.contentType).toBe('image/webp')
    expect(view.imageUrl).toBe(img.blobUrl)
    expect(view.imageSrcSet).toBe(buildImageSrcSet({ original: img.blobUrl, ...img }))
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

  it('upload de bytes que o sharp não lê ⇒ 400 tipo_invalido (#596): nada guardado, nenhuma recipe_image', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dono3@deriv.test' })
    const id = await seedOwned(userId)
    const res = await uploadRoute(uploadReq(id, Buffer.from([1, 2, 3, 4]), headers), ctx(id))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await faceOf(id)).toBeNull()
    expect(await getDb().select().from(recipeImage)).toEqual([])
  })

  it('upload de SVG rotulado image/png ⇒ 400 tipo_invalido, rápido (sem renderizar) e sem nada guardado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'svg@deriv.test' })
    const id = await seedOwned(userId)
    const t0 = performance.now()
    const res = await uploadRoute(uploadReq(id, HEAVY_SVG, headers), ctx(id))
    expect(performance.now() - t0).toBeLessThan(2_000)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await getDb().select().from(recipeImage)).toEqual([])
  })

  it('upload do catálogo (curador): original re-encodado em WebP (#596) + par', async () => {
    const curator = await seedUser({ email: 'cur@deriv.test', role: 'curador' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Moqueca', provenance: 'automatica_nao_revisada' })

    const res = await applyCatalogImageUpload({ db: getDb(), store, id, curatorId: curator, data: PNG })
    expect(res.kind).toBe('ok')
    const img = await imageRow((await faceOf(id))!)
    expect(img.thumbUrl).not.toBeNull()
    expect(img.detailUrl).not.toBeNull()
    expect(img.blobUrl).toMatch(/\/recipes\/\d+\.webp$/)
    const meta = await sharp(Buffer.from(store.blobs.get(img.blobUrl)!.bytes)).metadata()
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(['webp', 1536, 1024, undefined])
    expect(res.kind === 'ok' && res.gallery[0].srcSet).toBe(buildImageSrcSet({ original: img.blobUrl, ...img }))
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
    expect(image.srcSet).toBe(buildImageSrcSet({ original: img.blobUrl, ...img }))
    expect(Buffer.from(store.blobs.get(img.blobUrl)!.bytes).equals(PNG)).toBe(true)

    const edit = await generateRoute(genReq(id, headers, { prompt: 'mais luz', sourceImageId: image.id }), ctx(id))
    expect(edit.status).toBe(200)
    expect(generator.lastSource?.contentType).toBe('image/png')
    expect(generator.lastSource?.data.equals(PNG)).toBe(true)
  })

  it('a edição imagem-a-imagem de uma foto ENVIADA lê o original re-encodado (WebP, sem EXIF)', async () => {
    const generator = new FakeImageGenerator({ data: PNG, contentType: 'image/png' })
    setImageGenerator(generator)
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-upload@deriv.test' })
    const id = await seedOwned(userId)
    const jpeg = await sharp(UPLOAD_PNG)
      .jpeg()
      .withMetadata({ exif: { IFD0: { Make: 'CelularDaCozinha' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } } })
      .toBuffer()
    expect((await sharp(jpeg).metadata()).exif).toBeDefined()

    expect((await uploadRoute(uploadReq(id, jpeg, headers), ctx(id))).status).toBe(200)
    const uploaded = (await faceOf(id))!
    const edit = await generateRoute(genReq(id, headers, { prompt: 'mais luz', sourceImageId: uploaded }), ctx(id))
    expect(edit.status).toBe(200)
    expect(generator.lastSource?.contentType).toBe('image/webp')
    expect((await sharp(generator.lastSource!.data).metadata()).exif).toBeUndefined()
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

  it('APAGAR da galeria do catálogo (curador): original + 2 derivados somem', async () => {
    const curator = await seedUser({ email: 'catdel@deriv.test', role: 'curador' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Vatapá', provenance: 'automatica_nao_revisada' })
    const upload = (data: Buffer) => applyCatalogImageUpload({ db: getDb(), store, id, curatorId: curator, data })
    expect((await upload(UPLOAD_PNG)).kind).toBe('ok')
    const first = (await faceOf(id))!
    expect((await upload(SMALL_PNG)).kind).toBe('ok') // a 2ª vira a face; a 1ª fica livre
    expect(store.blobs.size).toBe(6)
    const row = await imageRow(first)

    const res = await applyCatalogGalleryImageDelete({ db: getDb(), store, id, imageId: first })
    expect(res.kind).toBe('ok')
    expect(store.blobs.size).toBe(3)
    for (const url of [row.blobUrl, row.thumbUrl!, row.detailUrl!]) expect(store.blobs.has(url)).toBe(false)
  })

  it('escalada `record_deletion` do operador (reap): original + derivados da importada somem', async () => {
    const admin = await seedUser({ email: 'op@deriv.test', role: 'admin' })
    const id = await seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', visibility: 'private', ownerId: null })
    await getDb()
      .update(recipe)
      .set({ sourceName: 'Blog da Fulana', sourceUrl: 'https://blog.example/bolo' })
      .where(eq(recipe.id, id))
    const { imageId } = await seedLegacyImage(id, { face: true })
    await backfillImageDerivatives(getDb(), store)
    const row = await imageRow(imageId)
    expect(row.thumbUrl).not.toBeNull()
    expect(store.blobs.size).toBe(3)

    const res = await operatorEscalateSource({
      db: getDb(),
      actorId: admin,
      query: { sourceName: 'Blog da Fulana' },
      action: 'record_deletion',
      apply: true,
      store,
    })
    expect(res.matched).toBe(1)
    expect(await imageRow(imageId)).toBeUndefined()
    expect(store.blobs.size).toBe(0)
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
    return { id, imageId, srcSet: buildImageSrcSet({ original: img.blobUrl, ...img })! }
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
    expect(r1).toEqual({
      pendentes: 2,
      nuncaTentadas: 2,
      tentadas: 2,
      preenchidas: 2,
      falhas: 0,
      descartadas: 0,
      restantes: 0,
      nuncaTentadasRestantes: 0,
    })
    for (const { imageId, blobUrl } of [a, b]) {
      const row = await imageRow(imageId)
      expect(row.blobUrl).toBe(blobUrl)
      expect(Buffer.from(store.blobs.get(blobUrl)!.bytes).equals(SMALL_PNG)).toBe(true)
      expect(row.thumbUrl).not.toBeNull()
      expect(row.detailUrl).not.toBeNull()
    }
    expect(store.blobs.size).toBe(6)

    const r2 = await backfillImageDerivatives(getDb(), store)
    expect(r2).toEqual({
      pendentes: 0,
      nuncaTentadas: 0,
      tentadas: 0,
      preenchidas: 0,
      falhas: 0,
      descartadas: 0,
      restantes: 0,
      nuncaTentadasRestantes: 0,
    })
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
    expect(r).toMatchObject({ pendentes: 2, tentadas: 1, preenchidas: 1, restantes: 1, nuncaTentadasRestantes: 1 })
    expect((await imageRow(face.imageId)).thumbUrl).not.toBeNull()
    expect((await imageRow(galleryOnly.imageId)).thumbUrl).toBeNull()
    expect((await imageRow(done.imageId)).thumbUrl).toBe('https://fake-blob.local/x/t.webp')
  })

  it('falha permanente sai da fila por 7 dias (sem fome, sem baixar todo dia) e conta em falhas', async () => {
    const owner = await seedUser({ email: 'bf3@deriv.test' })
    const id = await seedOwned(owner)
    const broken = await seedLegacyImage(id, { face: true, createdAt: new Date('2026-01-01T00:00:00Z') })
    store.blobs.delete(broken.blobUrl) // original sumiu do Blob
    const ok = await seedLegacyImage(id)
    const day0 = new Date('2026-10-14T10:30:00Z')
    const at = (days: number) => new Date(day0.getTime() + days * 86_400_000)

    const r1 = await backfillImageDerivatives(getDb(), store, { limit: 1, now: day0 })
    expect(r1).toMatchObject({ pendentes: 2, nuncaTentadas: 2, tentadas: 1, falhas: 1, preenchidas: 0 })
    expect(r1).toMatchObject({ restantes: 1, nuncaTentadasRestantes: 1 })
    expect((await imageRow(broken.imageId)).derivativesAttemptedAt).toEqual(day0)

    const r2 = await backfillImageDerivatives(getDb(), store, { limit: 1, now: at(1) })
    expect(r2).toMatchObject({ pendentes: 1, tentadas: 1, preenchidas: 1, restantes: 0, nuncaTentadasRestantes: 0 })
    expect((await imageRow(ok.imageId)).thumbUrl).not.toBeNull()

    // Dentro dos 7 dias a quebrada não volta: a passada é só a contagem.
    let gets = 0
    const spy: ImageStore = Object.assign(Object.create(store), {
      get: async (url: string) => {
        gets++
        return store.get(url)
      },
    })
    const r3 = await backfillImageDerivatives(getDb(), spy, { now: at(6) })
    expect(r3).toMatchObject({ pendentes: 0, tentadas: 0, restantes: 0 })
    expect(gets).toBe(0)

    // Passados 7 dias, volta UMA vez, falha de novo e sai por mais 7 dias.
    const r4 = await backfillImageDerivatives(getDb(), spy, { now: at(8) })
    expect(r4).toMatchObject({ pendentes: 1, nuncaTentadas: 0, tentadas: 1, falhas: 1, restantes: 0 })
    expect(gets).toBe(1)
    expect((await imageRow(broken.imageId)).derivativesAttemptedAt).toEqual(at(8))
    expect((await backfillImageDerivatives(getDb(), spy, { now: at(9) })).tentadas).toBe(0)
  })

  it('imagem moderada fica fora da fila (não é baixada nem contada)', async () => {
    const owner = await seedUser({ email: 'bf8@deriv.test' })
    const curator = await seedUser({ email: 'bf8c@deriv.test', role: 'curador' })
    const id = await seedOwned(owner)
    const moderated = await seedLegacyImage(id, { face: true })
    await getDb()
      .update(recipeImage)
      .set({ moderatedAt: new Date(), moderatedReason: 'teste', moderatedBy: curator })
      .where(eq(recipeImage.id, moderated.imageId))
    const r = await backfillImageDerivatives(getDb(), store)
    expect(r).toMatchObject({ pendentes: 0, tentadas: 0, restantes: 0 })
    const row = await imageRow(moderated.imageId)
    expect([row.thumbUrl, row.derivativesAttemptedAt]).toEqual([null, null])
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
    const res = await backfillImageDerivatives(getDb(), store, { budgetMs: 10, reserveMs: 0, clock: () => (t += 6) })
    expect(res).toMatchObject({ pendentes: 2, tentadas: 1, restantes: 1 })
  })

  it('reserva do orçamento: com menos de 15 s sobrando (padrão), não começa imagem nova', async () => {
    const owner = await seedUser({ email: 'bf9@deriv.test' })
    const id = await seedOwned(owner)
    await seedLegacyImage(id)
    await seedLegacyImage(id)
    // Cada leitura do relógio avança 20 s (início em 0): a 1ª imagem começa aos 20 s (sobram 20 s dos
    // 40), a 2ª começaria aos 40 s (sobra 0 < 15 s) e não começa.
    let t = -20_000
    const res = await backfillImageDerivatives(getDb(), store, { clock: () => (t += 20_000) })
    expect(res).toMatchObject({ pendentes: 2, tentadas: 1, preenchidas: 1, restantes: 1 })
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
      nuncaTentadas: 1,
      tentadas: 1,
      preenchidas: 1,
      falhas: 0,
      descartadas: 0,
      restantes: 0,
      nuncaTentadasRestantes: 0,
    })
  })
})
