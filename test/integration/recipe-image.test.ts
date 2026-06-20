import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST, DELETE } from '@/app/api/recipes/[id]/image/route'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore, ThrowingImageStore } from '@/server/images/image-store'
import { recipe, recipeImage } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders, seedDeletedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Round-trip da Imagem da receita (#130, ADR-0016) — contrato `/api/recipes/[id]/image` + entidade
 * `recipe_image` ref-counted. Owner-only (catálogo/não-dono ⇒ 404, ADR-0011). FakeImageStore
 * injetado — NUNCA toca a rede. Cobre: upload cria recipe_image (`user_photo`) + seta image_id;
 * troca/remoção com REF-COUNT (blob só apaga quando 0 referências); degradação do storage → 503.
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000'

let store: FakeImageStore
beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
})

function pngFile(bytes = new Uint8Array([1, 2, 3, 4]), name = 'p.png'): File {
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
    expect(store.blobs.has(view.imageUrl!)).toBe(true)

    const imageId = await readImageId(id)
    expect(imageId).not.toBeNull()
    const [img] = await getDb()
      .select({ blobUrl: recipeImage.blobUrl, provenance: recipeImage.provenance, createdBy: recipeImage.createdBy })
      .from(recipeImage)
      .where(eq(recipeImage.id, imageId!))
    expect(img).toMatchObject({ blobUrl: view.imageUrl, provenance: 'user_photo', createdBy: userId })
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

  it('TROCA: ref-count 0 ⇒ apaga a recipe_image antiga e o blob; mantém só a nova', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'troca@ri.test' })
    const id = await seedOwnedRecipe(userId)

    const first = (await (await POST(postReq(id, pngFile(), headers), ctx(id))).json()) as { imageUrl: string }
    const firstImageId = await readImageId(id)
    const second = (await (await POST(postReq(id, pngFile(), headers), ctx(id))).json()) as { imageUrl: string }

    expect(second.imageUrl).not.toBe(first.imageUrl)
    expect(await countImages()).toBe(1) // a antiga foi reaproveitada (apagada)
    expect(store.blobs.has(first.imageUrl)).toBe(false) // blob antigo apagado (0 refs)
    expect(store.blobs.has(second.imageUrl)).toBe(true)
    // A linha recipe_image antiga não existe mais; a nova é a apontada.
    const newImageId = await readImageId(id)
    expect(newImageId).not.toBe(firstImageId)
  })

  it('TROCA com carry-forward (#131): ref-count > 0 ⇒ NÃO apaga a imagem compartilhada', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'carry@ri.test' })
    const idA = await seedOwnedRecipe(userId, 'Versão A')

    // Upload em A cria a imagem X (A.image_id = X).
    const first = (await (await POST(postReq(idA, pngFile(), headers), ctx(idA))).json()) as { imageUrl: string }
    const sharedImageId = await readImageId(idA)
    // Simula o carry-forward (#131): uma 2ª versão B aponta para o MESMO image_id X.
    const idB = await seedOwnedRecipe(userId, 'Versão B')
    await getDb().update(recipe).set({ imageId: sharedImageId }).where(eq(recipe.id, idB))

    // Troca a foto de A → cria Y; X ainda é referenciada por B ⇒ X (linha + blob) PERMANECE.
    const second = (await (await POST(postReq(idA, pngFile(), headers), ctx(idA))).json()) as { imageUrl: string }

    expect(second.imageUrl).not.toBe(first.imageUrl)
    expect(store.blobs.has(first.imageUrl)).toBe(true) // X preservado (B ainda usa)
    expect(store.blobs.has(second.imageUrl)).toBe(true) // Y novo
    expect(await readImageId(idB)).toBe(sharedImageId) // B segue apontando X
    expect(await countImages()).toBe(2) // X e Y coexistem
  })

  it('DELETE: zera image_id, apaga a recipe_image e o blob (ref-count 0)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del@ri.test' })
    const id = await seedOwnedRecipe(userId)
    const created = (await (await POST(postReq(id, pngFile(), headers), ctx(id))).json()) as { imageUrl: string }

    const res = await DELETE(deleteReq(id, headers), ctx(id))
    expect(res.status).toBe(200)
    expect(await readImageId(id)).toBeNull()
    expect(await countImages()).toBe(0)
    expect(store.blobs.has(created.imageUrl)).toBe(false)
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
