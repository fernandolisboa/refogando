import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { POST, DELETE } from '@/app/api/recipes/[id]/image/route'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore, ThrowingImageStore } from '@/server/images/image-store'
import { recipe, recipeImage } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders, seedDeletedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Round-trip da Imagem da receita (#130/#222, ADR-0016/0022) — contrato `/api/recipes/[id]/image` +
 * entidade `recipe_image` por LINHAGEM. Owner-only (catálogo/não-dono ⇒ 404, ADR-0011). FakeImageStore
 * injetado — NUNCA toca a rede. Cobre: upload cria recipe_image (`user_photo`) + AUTO-SELECIONA;
 * #222: TROCA ACRESCENTA à galeria e NÃO reapa (o reap-on-swap saiu de cena — DECISION 4); DELETE
 * /image agora DESSELECIONA (zera image_id, NÃO apaga: a imagem fica na galeria); degradação → 503.
 * #596: o upload é RE-ENCODADO (WebP ≤2048 px sem EXIF/GPS); bytes que não são imagem ⇒ 400.
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

/** Ponteiro para o IFD de GPS (tag 0x8825) no EXIF little-endian (`II`) que o libvips escreve. */
const hasGpsIfd = (exif: Buffer) => exif.includes(Buffer.from([0x25, 0x88]))

/** PNG de verdade: desde o #596 o servidor re-encoda, e bytes que não são imagem viram 400. */
let PNG_BYTES: Uint8Array<ArrayBuffer>
beforeAll(async () => {
  PNG_BYTES = new Uint8Array(
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } }).png().toBuffer(),
  )
})

let store: FakeImageStore
beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
})

function pngFile(bytes: Uint8Array<ArrayBuffer> = PNG_BYTES, name = 'p.png'): File {
  return new File([bytes], name, { type: 'image/png' })
}
function postReq(id: string, file: File | null, headers?: Headers): Request {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request(`http://localhost/api/recipes/${id}/image`, { method: 'POST', body: fd, headers })
}
function deleteReq(id: string, headers?: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/image`, { method: 'DELETE', headers })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

/** Semeia uma Receita do dono com uma tradução pt-BR (pra a view montar). Devolve o recipeId. */
async function seedOwnedRecipe(ownerId: string, titulo = 'Bolo'): Promise<string> {
  const id = await seedRecipe({ origin: 'user_edited', originalLocale: 'pt-BR', ownerId, visibility: 'private' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}
async function readImageId(recipeId: string): Promise<string | null> {
  const [row] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, recipeId))
  return row?.imageId ?? null
}
async function countImages(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(recipeImage)
  return row?.n ?? 0
}

describe('/api/recipes/[id]/image — upload/troca/remoção (#130)', () => {
  it('anon → 401 em POST e DELETE', async () => {
    const owner = await seedUser({ email: 'dono@ri.test' })
    const id = await seedOwnedRecipe(owner)

    const p = await POST(postReq(id, pngFile()), ctx(id))
    expect(p.status).toBe(401)
    const d = await DELETE(deleteReq(id), ctx(id))
    expect(d.status).toBe(401)
  })

  it('id malformado → 404 (sem tocar storage/DB)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'u@ri.test' })
    const res = await POST(postReq('nao-uuid', pngFile(), headers), ctx('nao-uuid'))
    expect(res.status).toBe(404)
    expect(store.blobs.size).toBe(0)
  })

  it('não-dono → 404 (não vaza existência); nada gravado', async () => {
    const owner = await seedUser({ email: 'owner@ri.test' })
    const id = await seedOwnedRecipe(owner)
    const { headers } = await seedSessionHeaders({ email: 'intruso@ri.test' })

    const res = await POST(postReq(id, pngFile(), headers), ctx(id))
    expect(res.status).toBe(404)
    expect(await readImageId(id)).toBeNull()
    expect(store.blobs.size).toBe(0)
  })

  it('catálogo (ownerId NULL) → 404 mesmo logado', async () => {
    const catalogId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: catalogId, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    const { headers } = await seedSessionHeaders({ email: 'qualquer@ri.test' })

    const res = await POST(postReq(catalogId, pngFile(), headers), ctx(catalogId))
    expect(res.status).toBe(404)
  })

  it('conta soft-deletada → 401', async () => {
    const { headers } = await seedDeletedSessionHeaders({ email: 'morto@ri.test' })
    const res = await POST(postReq(NIL_UUID, pngFile(), headers), ctx(NIL_UUID))
    expect(res.status).toBe(401)
  })

  it('dono sobe foto → 200, cria recipe_image (user_photo), seta image_id, view traz imageUrl', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'sobe@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const res = await POST(postReq(id, pngFile(), headers), ctx(id))
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string; imageUrl?: string }
    expect(view.imageUrl).toBeDefined()
    expect(store.owns(view.imageUrl!)).toBe(true)
    expect(view.imageUrl).toMatch(/\/recipes\/\d+\.webp$/)
    expect(store.blobs.get(view.imageUrl!)?.contentType).toBe('image/webp')

    const imageId = await readImageId(id)
    expect(imageId).not.toBeNull()
    const [img] = await getDb()
      .select({ blobUrl: recipeImage.blobUrl, provenance: recipeImage.provenance, createdBy: recipeImage.createdBy })
      .from(recipeImage)
      .where(eq(recipeImage.id, imageId!))
    expect(img).toMatchObject({ blobUrl: view.imageUrl, provenance: 'user_photo', createdBy: userId })
  })

  it('#596 JPEG com EXIF/GPS → o original guardado é WebP sem EXIF, sem GPS e ≤2048 px', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gps@ri.test' })
    const id = await seedOwnedRecipe(userId)
    const jpeg = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#3a6' } })
      .jpeg()
      .withMetadata({
        exif: { IFD0: { Make: 'CelularDaCozinha' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } },
      })
      .toBuffer()
    expect(hasGpsIfd((await sharp(jpeg).metadata()).exif!)).toBe(true)

    const res = await POST(postReq(id, new File([new Uint8Array(jpeg)], 'f.jpg', { type: 'image/jpeg' }), headers), ctx(id))
    expect(res.status).toBe(200)
    const view = (await res.json()) as { imageUrl: string }
    const [img] = await getDb()
      .select({ blobUrl: recipeImage.blobUrl })
      .from(recipeImage)
      .where(eq(recipeImage.id, (await readImageId(id))!))
    expect(img.blobUrl).toBe(view.imageUrl)
    const bytes = Buffer.from(store.blobs.get(img.blobUrl)!.bytes)
    const meta = await sharp(bytes).metadata()
    expect([meta.format, meta.width, meta.height, meta.exif, meta.icc, meta.xmp]).toEqual([
      'webp',
      2048,
      1024,
      undefined,
      undefined,
      undefined,
    ])
    expect(bytes.toString('latin1')).not.toContain('CelularDaCozinha')
  })

  it('#596 bytes que não são imagem (rótulo image/png) → 400 tipo_invalido; nada guardado nem gravado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'lixo@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const res = await POST(postReq(id, pngFile(new Uint8Array([1, 2, 3, 4])), headers), ctx(id))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await readImageId(id)).toBeNull()
    expect(await countImages()).toBe(0)
  })

  it('#596 bytes que não são imagem, de um NÃO-dono → 404 (o gate de dono vem antes do re-encode)', async () => {
    const owner = await seedUser({ email: 'owner-lixo@ri.test' })
    const id = await seedOwnedRecipe(owner)
    const { headers } = await seedSessionHeaders({ email: 'intruso-lixo@ri.test' })

    const res = await POST(postReq(id, pngFile(new Uint8Array([1, 2, 3, 4])), headers), ctx(id))
    expect(res.status).toBe(404)
    expect(store.blobs.size).toBe(0)
  })

  it('tipo inválido → 400; oversize → 400; sem arquivo → 400 (nada gravado)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'val@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const bad = await POST(postReq(id, new File(['x'], 'a.txt', { type: 'text/plain' }), headers), ctx(id))
    expect(bad.status).toBe(400)
    const big = await POST(postReq(id, pngFile(new Uint8Array(2 * 1024 * 1024 + 1)), headers), ctx(id))
    expect(big.status).toBe(400)
    const none = await POST(postReq(id, null, headers), ctx(id))
    expect(none.status).toBe(400)

    expect(await readImageId(id)).toBeNull()
    expect(await countImages()).toBe(0)
  })

  it('#222 TROCA ACRESCENTA à galeria (NÃO reapa): 2 imagens, a NOVA vira a face, o blob antigo PERMANECE', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'troca@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const first = (await (await POST(postReq(id, pngFile(), headers), ctx(id))).json()) as { imageUrl: string }
    const firstImageId = await readImageId(id)
    const second = (await (await POST(postReq(id, pngFile(), headers), ctx(id))).json()) as { imageUrl: string }

    expect(second.imageUrl).not.toBe(first.imageUrl)
    // #222: o reap-on-swap saiu de cena (DECISION 4) — a antiga FICA na galeria.
    expect(await countImages()).toBe(2)
    expect(store.blobs.has(first.imageUrl)).toBe(true) // blob antigo PRESERVADO (não reapado)
    expect(store.blobs.has(second.imageUrl)).toBe(true)
    // A face agora aponta a NOVA imagem (upload auto-seleciona); ambas na MESMA linhagem.
    const newImageId = await readImageId(id)
    expect(newImageId).not.toBe(firstImageId)
    const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, id))
    const lineages = await getDb().select({ lineageId: recipeImage.lineageId }).from(recipeImage)
    expect(lineages.every((l) => l.lineageId === r.lineageId)).toBe(true)
  })

  it('#222 DELETE = DESSELECIONAR: zera image_id mas NÃO apaga (a imagem fica na galeria, blob preservado)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del@ri.test' })
    const id = await seedOwnedRecipe(userId)
    const created = (await (await POST(postReq(id, pngFile(), headers), ctx(id))).json()) as { imageUrl: string }

    const res = await DELETE(deleteReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    expect(await readImageId(id)).toBeNull() // desselecionada (volta ao placeholder)
    // #222: NÃO reapa — a linha recipe_image e o blob PERMANECEM (re-selecionáveis na galeria).
    expect(await countImages()).toBe(1)
    expect(store.blobs.has(created.imageUrl)).toBe(true)
  })

  it('DELETE numa Receita SEM foto → 200 no-op idempotente (nada a apagar)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'noop@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const res = await DELETE(deleteReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    expect(await readImageId(id)).toBeNull()
    expect(await countImages()).toBe(0)
    expect(store.blobs.size).toBe(0)
  })

  it('storage indisponível (ThrowingImageStore) → 503; image_id intacto, nenhuma recipe_image', async () => {
    setImageStore(new ThrowingImageStore())
    const { userId, headers } = await seedSessionHeaders({ email: 'down@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const res = await POST(postReq(id, pngFile(), headers), ctx(id))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: 'storage_indisponivel' })
    expect(await readImageId(id)).toBeNull()
    expect(await countImages()).toBe(0)
  })
})
