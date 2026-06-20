import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST, DELETE } from '@/app/api/me/avatar/route'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore, ThrowingImageStore } from '@/server/images/image-store'
import { recipe, users } from '@/db/schema'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import { seedFeijoadaCatalog } from '../helpers/recipes'

/**
 * Round-trip do avatar do logado (#126) — contrato `/api/me/avatar` + fundação do `ImageStore`.
 *
 * Owner-only via requireSession (ADR-0011): Visitante → 401. POST(multipart `file`) valida tipo +
 * tamanho, guarda no `ImageStore` (FakeImageStore injetado — NUNCA toca a rede), grava `users.image`
 * e apaga o blob ANTERIOR se foi nosso (OAuth/estrangeiro fica intacto). DELETE zera `users.image`.
 *
 * Toca SÓ `users` — o avatar NÃO usa a entidade `recipe_image` (ADR-0016).
 */

const FOREIGN_URL = 'https://lh3.googleusercontent.com/a/foto-do-google'

let store: FakeImageStore
beforeEach(() => {
  // O beforeEach global (setup.ts) já rodou resetDeps(); injetamos um Fake fresco por teste.
  store = new FakeImageStore()
  setImageStore(store)
})

function pngFile(bytes = new Uint8Array([1, 2, 3, 4]), name = 'a.png'): File {
  return new File([bytes], name, { type: 'image/png' })
}

function postReq(file: File | null, headers?: Headers): Request {
  const fd = new FormData()
  if (file) fd.append('file', file)
  return new Request('http://localhost/api/me/avatar', { method: 'POST', body: fd, headers })
}
function deleteReq(headers?: Headers): Request {
  return new Request('http://localhost/api/me/avatar', { method: 'DELETE', headers })
}

async function readImage(id: string): Promise<string | null> {
  const [row] = await getDb().select({ image: users.image }).from(users).where(eq(users.id, id))
  return row?.image ?? null
}
async function countRecipes(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(recipe)
  return row?.n ?? 0
}

describe('/api/me/avatar — round-trip do avatar do logado (#126)', () => {
  it('sem sessão (Visitante) → 401 em POST e DELETE', async () => {
    const postRes = await POST(postReq(pngFile()))
    expect(postRes.status).toBe(401)
    await expect(postRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

    const delRes = await DELETE(deleteReq())
    expect(delRes.status).toBe(401)
    await expect(delRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('conta soft-deletada (deletedAt != null) → 401 conta_desativada em POST e DELETE', async () => {
    const { headers } = await seedDeletedSessionHeaders({ email: 'apagado@me-avatar.test' })

    const postRes = await POST(postReq(pngFile(), headers))
    expect(postRes.status).toBe(401)
    await expect(postRes.json()).resolves.toMatchObject({ error: 'conta_desativada' })

    const delRes = await DELETE(deleteReq(headers))
    expect(delRes.status).toBe(401)
    await expect(delRes.json()).resolves.toMatchObject({ error: 'conta_desativada' })
  })

  it('storage indisponível (ThrowingImageStore) → 503 e users.image INTACTO (store falha antes do UPDATE)', async () => {
    setImageStore(new ThrowingImageStore())
    const { userId, headers } = await seedSessionHeaders({ email: 'down@me-avatar.test' })

    const res = await POST(postReq(pngFile(), headers))
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toMatchObject({ error: 'storage_indisponivel' })
    // O store falha ANTES do UPDATE: o avatar continua null (nada de estado parcial).
    expect(await readImage(userId)).toBeNull()
  })

  it('POST de imagem válida → 200, guarda o blob, grava users.image', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'av@me-avatar.test' })

    const res = await POST(postReq(pngFile(), headers))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { image: string }
    expect(store.owns(body.image)).toBe(true)
    expect(store.blobs.has(body.image)).toBe(true)
    expect(await readImage(userId)).toBe(body.image)
  })

  it('POST que TROCA um avatar nosso apaga o blob anterior e mantém só o novo', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'troca@me-avatar.test' })

    const first = (await (await POST(postReq(pngFile(), headers))).json()) as { image: string }
    const second = (await (await POST(postReq(pngFile(), headers))).json()) as { image: string }

    expect(second.image).not.toBe(first.image)
    expect(store.blobs.has(first.image)).toBe(false) // anterior apagado
    expect(store.blobs.has(second.image)).toBe(true) // novo presente
    expect(await readImage(userId)).toBe(second.image)
  })

  it('POST sobre avatar ESTRANGEIRO (OAuth) NÃO tenta apagar a URL alheia', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'oauth@me-avatar.test' })
    // Simula o avatar vindo do Google OAuth (URL estrangeira em users.image).
    await getDb().update(users).set({ image: FOREIGN_URL }).where(eq(users.id, userId))

    const res = await POST(postReq(pngFile(), headers))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { image: string }

    expect(await readImage(userId)).toBe(body.image)
    // Só o blob novo existe no store; a URL do Google nunca foi "nossa" (nada a apagar, sem throw).
    expect(store.blobs.size).toBe(1)
    expect(store.blobs.has(body.image)).toBe(true)
  })

  it('POST sem arquivo → 400 arquivo_ausente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'sem@me-avatar.test' })
    const res = await POST(postReq(null, headers))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'arquivo_ausente' })
  })

  it('POST com content-type não permitido → 400 tipo_invalido (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'tipo@me-avatar.test' })
    const bad = new File(['oi'], 'a.txt', { type: 'text/plain' })
    const res = await POST(postReq(bad, headers))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'tipo_invalido' })
    expect(await readImage(userId)).toBeNull()
    expect(store.blobs.size).toBe(0)
  })

  it('POST acima do cap (2 MB) → 400 arquivo_grande (não grava)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'grande@me-avatar.test' })
    const tooBig = pngFile(new Uint8Array(2 * 1024 * 1024 + 1))
    const res = await POST(postReq(tooBig, headers))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'arquivo_grande' })
    expect(await readImage(userId)).toBeNull()
    expect(store.blobs.size).toBe(0)
  })

  it('DELETE remove o avatar nosso: zera users.image e apaga o blob', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'del@me-avatar.test' })
    const created = (await (await POST(postReq(pngFile(), headers))).json()) as { image: string }
    expect(store.blobs.has(created.image)).toBe(true)

    const res = await DELETE(deleteReq(headers))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ image: null })
    expect(await readImage(userId)).toBeNull()
    expect(store.blobs.has(created.image)).toBe(false)
  })

  it('DELETE com avatar ESTRANGEIRO zera users.image sem apagar a URL alheia', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'deloauth@me-avatar.test' })
    await getDb().update(users).set({ image: FOREIGN_URL }).where(eq(users.id, userId))

    const res = await DELETE(deleteReq(headers))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ image: null })
    expect(await readImage(userId)).toBeNull()
  })

  it('subir avatar NÃO cria/edita Receita (toca só users)', async () => {
    await seedFeijoadaCatalog()
    const before = await countRecipes()
    expect(before).toBeGreaterThan(0)

    const { headers } = await seedSessionHeaders({ email: 'isola@me-avatar.test' })
    const res = await POST(postReq(pngFile(), headers))
    expect(res.status).toBe(200)

    expect(await countRecipes()).toBe(before)
  })
})
