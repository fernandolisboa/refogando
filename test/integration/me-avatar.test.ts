import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { POST, DELETE } from '@/app/api/me/avatar/route'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore, ThrowingImageStore } from '@/server/images/image-store'
import { avatarPathPrefix } from '@/server/images/avatar-blob'
import { recipe, users } from '@/db/schema'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import { seedFeijoadaCatalog } from '../helpers/recipes'

/**
 * Round-trip do avatar do logado (#126) — contrato `/api/me/avatar` + fundação do `ImageStore`.
 *
 * Owner-only via requireSession (ADR-0011): Visitante → 401. POST(multipart `file`) valida tipo +
 * tamanho, RE-ENCODA (#596: WebP ≤1024 px sem EXIF/GPS; bytes que não são imagem ⇒ 400), guarda no
 * `ImageStore` (FakeImageStore injetado — NUNCA toca a rede), grava `users.image` e apaga o blob
 * ANTERIOR se foi nosso (OAuth/estrangeiro fica intacto). DELETE zera `users.image`.
 *
 * Toca SÓ `users` — o avatar NÃO usa a entidade `recipe_image` (ADR-0016).
 */

const FOREIGN_URL = 'https://lh3.googleusercontent.com/a/foto-do-google'

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
  // O beforeEach global (setup.ts) já rodou resetDeps(); injetamos um Fake fresco por teste.
  store = new FakeImageStore()
  setImageStore(store)
})

function pngFile(bytes: Uint8Array<ArrayBuffer> = PNG_BYTES, name = 'a.png'): File {
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

  it('POST de imagem válida → 200, guarda o blob (WebP re-encodado), grava users.image', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'av@me-avatar.test' })

    const res = await POST(postReq(pngFile(), headers))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { image: string }
    expect(store.owns(body.image)).toBe(true)
    // #604: o avatar mora sob o prefixo opaco da conta (`avatars/<chave>/`), nunca com o id cru.
    expect(body.image).toMatch(new RegExp(`/${avatarPathPrefix(userId)}/\\d+\\.webp$`))
    expect(body.image).not.toContain(userId)
    const blob = store.blobs.get(body.image)!
    expect(blob.contentType).toBe('image/webp')
    const meta = await sharp(Buffer.from(blob.bytes)).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 64, 48])
    expect(await readImage(userId)).toBe(body.image)
  })

  it('POST de JPEG com EXIF/GPS (#596) → o blob público sai sem EXIF, sem GPS e ≤1024 px', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'gps@me-avatar.test' })
    const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3a6' } })
      .jpeg()
      .withMetadata({
        exif: { IFD0: { Make: 'CelularDaCozinha' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1' } },
      })
      .toBuffer()
    const before = await sharp(jpeg).metadata()
    expect(hasGpsIfd(before.exif!)).toBe(true)

    const res = await POST(postReq(new File([new Uint8Array(jpeg)], 'a.jpg', { type: 'image/jpeg' }), headers))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { image: string }
    const bytes = Buffer.from(store.blobs.get(body.image)!.bytes)
    const meta = await sharp(bytes).metadata()
    expect([meta.format, meta.width, meta.height, meta.exif, meta.icc, meta.xmp]).toEqual([
      'webp',
      1024,
      683,
      undefined,
      undefined,
      undefined,
    ])
    expect(bytes.toString('latin1')).not.toContain('CelularDaCozinha')
    expect(await readImage(userId)).toBe(body.image)
  })

  it('POST com bytes que não são imagem (rótulo image/png) → 400 tipo_invalido, sem blob e sem UPDATE', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'lixo@me-avatar.test' })
    const res = await POST(postReq(pngFile(new Uint8Array([1, 2, 3, 4])), headers))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await readImage(userId)).toBeNull()
  })

  it('POST de SVG rotulado image/png → 400 tipo_invalido (o formato vem dos bytes, não do rótulo)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'svg@me-avatar.test' })
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>')
    const res = await POST(postReq(pngFile(svg), headers))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'tipo_invalido' })
    expect(store.blobs.size).toBe(0)
    expect(await readImage(userId)).toBeNull()
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

  describe('#604 — só apaga o avatar DESTA conta', () => {
    /** Guarda um blob NOSSO (host do store) fora do avatar desta conta, como se fosse de outra pessoa. */
    async function otherAccountBlob(pathPrefix: string): Promise<string> {
      const { url } = await store.store({ data: PNG_BYTES, contentType: 'image/png', pathPrefix })
      return url
    }

    it('POST e DELETE com users.image apontando para blob de OUTRA pessoa NÃO apagam esse blob', async () => {
      const other = await seedSessionHeaders({ email: 'vitima@me-avatar.test' })
      const { userId, headers } = await seedSessionHeaders({ email: 'atacante@me-avatar.test' })
      const reviewPhoto = await otherAccountBlob('reviews')
      const otherAvatar = await otherAccountBlob(avatarPathPrefix(other.userId))
      // O avatar da outra conta é o que ela USA (é o caso real: um avatar largado já foi apagado na troca).
      await getDb().update(users).set({ image: otherAvatar }).where(eq(users.id, other.userId))

      await getDb().update(users).set({ image: reviewPhoto }).where(eq(users.id, userId))
      expect((await POST(postReq(pngFile(), headers))).status).toBe(200)
      expect(store.blobs.has(reviewPhoto)).toBe(true)

      await getDb().update(users).set({ image: otherAvatar }).where(eq(users.id, userId))
      expect((await DELETE(deleteReq(headers))).status).toBe(200)
      expect(store.blobs.has(otherAvatar)).toBe(true)
      expect(await readImage(userId)).toBeNull()
    })

    it('avatar ANTIGO (avatars/<arquivo>) só é apagado quando nenhuma outra conta aponta para ele', async () => {
      const { userId, headers } = await seedSessionHeaders({ email: 'antigo@me-avatar.test' })
      const legacy = await otherAccountBlob('avatars')
      await getDb().update(users).set({ image: legacy }).where(eq(users.id, userId))
      expect((await DELETE(deleteReq(headers))).status).toBe(200)
      expect(store.blobs.has(legacy)).toBe(false)

      const victim = await seedSessionHeaders({ email: 'dona@me-avatar.test' })
      const shared = await otherAccountBlob('avatars')
      await getDb().update(users).set({ image: shared }).where(eq(users.id, victim.userId))
      await getDb().update(users).set({ image: shared }).where(eq(users.id, userId))
      expect((await DELETE(deleteReq(headers))).status).toBe(200)
      expect(store.blobs.has(shared)).toBe(true)
      expect(await readImage(victim.userId)).toBe(shared)
    })

    it('variante não canônica (query, hash) ou outro host com o caminho de um avatar antigo alheio nunca apaga', async () => {
      const victim = await seedSessionHeaders({ email: 'variante-dona@me-avatar.test' })
      const { userId, headers } = await seedSessionHeaders({ email: 'variante-atacante@me-avatar.test' })
      const legacy = await otherAccountBlob('avatars')
      await getDb().update(users).set({ image: legacy }).where(eq(users.id, victim.userId))
      const del = vi.spyOn(store, 'delete')
      // Variantes não canônicas e o mesmo caminho em OUTRO store do Vercel: nenhuma chega a `store.delete`.
      const outroHost = legacy.replace('fake-blob.local', 'outro-store.local')
      vi.spyOn(store, 'owns').mockImplementation((u) => u.startsWith('https://fake-blob.local/') || u.startsWith('https://outro-store.local/'))
      for (const variant of [`${legacy}?x=1`, `${legacy}#f`, outroHost]) {
        await getDb().update(users).set({ image: variant }).where(eq(users.id, userId))
        expect((await DELETE(deleteReq(headers))).status).toBe(200)
      }
      expect(del).not.toHaveBeenCalled()
      expect(store.blobs.has(legacy)).toBe(true)
    })
  })
})
