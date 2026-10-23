import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore, ThrowingImageStore } from '@/server/images/image-store'
import { avatarPathPrefix, canDeleteAccountAvatar } from '@/server/images/avatar-blob'
import {
  BLOB_SWEEP_PREFIXES,
  BLOB_SWEEP_RATIO_MIN_ORPHANS,
  BLOB_SWEEP_RETAIN_BEFORE,
  LEGACY_PHOTO_AUDIT_UNTIL,
  LEGACY_PHOTO_CUTOFF,
  sweepBlobs,
} from '@/server/images/blob-sweep'
import { timeBudget } from '@/server/time-budget'
import { recipeImage, recipeReview, users } from '@/db/schema'
import { GET as cronGET } from '@/app/api/cron/blob-sweep/route'
import { seedRecipe, seedRecipeImage, seedReview } from '../helpers/recipes'
import { seedUser } from '../helpers/users'

/**
 * Varredura semanal do Blob (#603): órfão antigo sai; referenciado, recente e de prefixo desconhecido ficam; a
 * trava de proporção segura um banco que perdeu as linhas; fotos antigas com EXIF são re-encodadas no lugar.
 */

const NOW = new Date('2026-10-30T12:00:00Z')
const OLD = new Date('2026-10-01T00:00:00Z') // antes da carência e do corte das fotos antigas
const RECENT = new Date(NOW.getTime() - 60 * 60 * 1000) // 1 h atrás: dentro da carência
const AFTER_CUTOFF = new Date(LEGACY_PHOTO_CUTOFF.getTime() + 24 * 60 * 60 * 1000)

let store: FakeImageStore
let JPEG_EXIF: Buffer
let JPEG_CLEAN: Buffer

beforeAll(async () => {
  const base = sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 80, b: 40 } } })
  JPEG_EXIF = await base
    .clone()
    .jpeg()
    .withExif({ IFD0: { Copyright: 'cozinha de casa', Make: 'Celular' } })
    .toBuffer()
  JPEG_CLEAN = await base.clone().jpeg().toBuffer()
})

beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
})

async function put(prefix: string, uploadedAt: Date, bytes: Buffer = Buffer.from([1, 2, 3])): Promise<string> {
  const { url } = await store.store({ data: bytes, contentType: 'image/jpeg', pathPrefix: prefix })
  store.blobs.get(url)!.uploadedAt = uploadedAt
  return url
}

function run(now = NOW) {
  return sweepBlobs(getDb(), store, { now, budget: timeBudget({ budgetMs: 60_000, reserveMs: 1_000 }) })
}

async function recipeWithImage(blobUrl: string, provenance: 'user_photo' | 'ai_generated' = 'user_photo') {
  const owner = await seedUser({ email: `dono-${Math.random()}@ex.com` })
  const recipeId = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: owner })
  const imageId = await seedRecipeImage({ recipeId, blobUrl, provenance })
  return { owner, recipeId, imageId }
}

describe('sweepBlobs — órfãos (#603)', () => {
  it('apaga só o órfão antigo; referenciado, recente e prefixo desconhecido ficam; é idempotente', async () => {
    const avatar = await put('avatars', OLD)
    const original = await put('recipes', OLD)
    const thumb = await put('recipes/w400', OLD)
    const detail = await put('recipes/w1280', OLD)
    const reviewPhoto = await put('reviews', OLD)
    const orphanRecipe = await put('recipes', OLD)
    const orphanReview = await put('reviews', OLD)
    const recentOrphan = await put('recipes', RECENT)
    const unknownPrefix = await put('backups', OLD)

    const userId = await seedUser({ email: 'avatar@ex.com' })
    await getDb().update(users).set({ image: avatar }).where(eq(users.id, userId))
    const { recipeId, imageId } = await recipeWithImage(original, 'ai_generated')
    await getDb().update(recipeImage).set({ thumbUrl: thumb, detailUrl: detail }).where(eq(recipeImage.id, imageId))
    const reviewer = await seedUser({ email: 'avaliador@ex.com' })
    const reviewId = await seedReview({ userId: reviewer, recipeId, rating: 5 })
    await getDb().update(recipeReview).set({ photoUrl: reviewPhoto }).where(eq(recipeReview.id, reviewId))

    const counts = await run()
    expect(counts).toMatchObject({ listados: 8, antigos: 7, orfaos: 2, apagados: 2, travada: 0, listagemIncompleta: 0 })
    for (const kept of [avatar, original, thumb, detail, reviewPhoto, recentOrphan, unknownPrefix]) {
      expect(store.blobs.has(kept)).toBe(true)
    }
    expect(store.blobs.has(orphanRecipe)).toBe(false)
    expect(store.blobs.has(orphanReview)).toBe(false)

    const again = await run()
    expect(again).toMatchObject({ orfaos: 0, apagados: 0 })
  })

  it('trava: órfãos demais (banco restaurado/errado) ⇒ não apaga nada e marca travada', async () => {
    const orphans = []
    for (let i = 0; i < BLOB_SWEEP_RATIO_MIN_ORPHANS; i++) orphans.push(await put('recipes', OLD))
    const kept = await put('recipes', OLD, JPEG_EXIF)
    await recipeWithImage(kept, 'user_photo')

    const counts = await run()
    expect(counts).toMatchObject({ antigos: BLOB_SWEEP_RATIO_MIN_ORPHANS + 1, orfaos: BLOB_SWEEP_RATIO_MIN_ORPHANS })
    expect(counts.travada).toBe(1)
    expect(counts.apagados).toBe(0)
    for (const url of orphans) expect(store.blobs.has(url)).toBe(true)
    // Travada, o passo das fotos antigas não roda (o banco pode ser o errado).
    expect(counts.fotosVerificadas).toBe(0)
    expect(store.blobs.has(kept)).toBe(true)
  })

  it('órfão anterior à restauração de 2026-09-18 fica retido (nunca sai sozinho) e não conta na proporção', async () => {
    await seedUser({ email: 'alguem@ex.com' })
    const before = new Date(BLOB_SWEEP_RETAIN_BEFORE.getTime() - 24 * 60 * 60 * 1000)
    const retained = []
    for (let i = 0; i < BLOB_SWEEP_RATIO_MIN_ORPHANS + 5; i++) retained.push(await put('recipes', before))
    const orphan = await put('recipes', OLD)

    const counts = await run()
    expect(counts).toMatchObject({ orfaos: BLOB_SWEEP_RATIO_MIN_ORPHANS + 6, orfaosRetidos: BLOB_SWEEP_RATIO_MIN_ORPHANS + 5 })
    expect(counts).toMatchObject({ travada: 0, apagados: 1, antigosNaoRetidos: 1 })
    for (const url of retained) expect(store.blobs.has(url)).toBe(true)
    expect(store.blobs.has(orphan)).toBe(false)
  })

  it('abaixo do mínimo da trava, mesmo com proporção alta, apaga (store pequeno)', async () => {
    await seedUser({ email: 'alguem@ex.com' })
    const orphan = await put('recipes', OLD)
    const counts = await run()
    expect(counts).toMatchObject({ antigos: 1, orfaos: 1, apagados: 1, travada: 0 })
    expect(store.blobs.has(orphan)).toBe(false)
  })

  it('pagina a listagem (mais de uma página por prefixo)', async () => {
    class PagedStore extends FakeImageStore {
      override list(o: { prefix: string; cursor?: string }) {
        return super.list({ ...o, limit: 2 })
      }
    }
    store = new PagedStore()
    await seedUser({ email: 'alguem@ex.com' })
    for (let i = 0; i < 5; i++) await put('reviews', OLD)
    const counts = await run()
    expect(counts).toMatchObject({ listados: 5, orfaos: 5, apagados: 5 })
    expect(store.blobs.size).toBe(0)
  })
})

describe('sweepBlobs — fotos antigas com metadado (#603)', () => {
  it('re-encoda foto de receita e avatar antigos com EXIF, troca a URL e apaga o original', async () => {
    const recipeOld = await put('recipes', OLD, JPEG_EXIF)
    const avatarOld = await put('avatars', OLD, JPEG_EXIF)
    const { imageId } = await recipeWithImage(recipeOld, 'user_photo')
    const userId = await seedUser({ email: 'avatar-exif@ex.com' })
    await getDb().update(users).set({ image: avatarOld }).where(eq(users.id, userId))
    expect((await sharp(JPEG_EXIF).metadata()).exif).toBeDefined()

    const counts = await run()
    expect(counts).toMatchObject({ fotosVerificadas: 2, fotosComMetadado: 2, fotosReencodadas: 2, fotosFalhas: 0 })

    const [img] = await getDb().select({ blobUrl: recipeImage.blobUrl }).from(recipeImage).where(eq(recipeImage.id, imageId))
    const [u] = await getDb().select({ image: users.image }).from(users).where(eq(users.id, userId))
    for (const [oldUrl, newUrl] of [
      [recipeOld, img.blobUrl],
      [avatarOld, u.image!],
    ]) {
      expect(newUrl).not.toBe(oldUrl)
      expect(store.blobs.has(oldUrl)).toBe(false)
      const meta = await sharp(Buffer.from(store.blobs.get(newUrl)!.bytes)).metadata()
      expect(meta.format).toBe('webp')
      expect(meta.exif).toBeUndefined()
    }
    // #604: o avatar re-encodado mora sob o prefixo da conta, e a troca/eliminação da conta o reconhece como dela.
    expect(new URL(u.image!).pathname.startsWith(`/${avatarPathPrefix(userId)}/`)).toBe(true)
    expect(await canDeleteAccountAvatar(getDb(), store, u.image, userId)).toBe(true)

    // A passada seguinte não baixa de novo o que já foi trocado (o blob novo é posterior ao corte).
    const again = await run(new Date(Date.now() + 48 * 60 * 60 * 1000))
    expect(again.fotosVerificadas).toBe(0)
  })

  it('não mexe em: foto limpa, imagem de IA, foto posterior ao corte, foto de avaliação; nem depois da data final', async () => {
    const clean = await put('recipes', OLD, JPEG_CLEAN)
    const ai = await put('recipes', OLD, JPEG_EXIF)
    const recent = await put('recipes', AFTER_CUTOFF, JPEG_EXIF)
    const review = await put('reviews', OLD, JPEG_EXIF)
    await recipeWithImage(clean, 'user_photo')
    await recipeWithImage(ai, 'ai_generated')
    const { recipeId } = await recipeWithImage(recent, 'user_photo')
    const reviewer = await seedUser({ email: 'av-foto@ex.com' })
    const reviewId = await seedReview({ userId: reviewer, recipeId, rating: 4 })
    await getDb().update(recipeReview).set({ photoUrl: review }).where(eq(recipeReview.id, reviewId))

    const counts = await run()
    expect(counts).toMatchObject({ fotosVerificadas: 1, fotosComMetadado: 0, fotosReencodadas: 0, orfaos: 0 })
    for (const url of [clean, ai, recent, review]) expect(store.blobs.has(url)).toBe(true)

    // Depois da data final o passo não roda (a foto com EXIF antiga ficaria; aqui só a contagem prova).
    const withExif = await put('recipes', OLD, JPEG_EXIF)
    await recipeWithImage(withExif, 'user_photo')
    const late = await run(new Date(LEGACY_PHOTO_AUDIT_UNTIL.getTime() + 1))
    expect(late.fotosVerificadas).toBe(0)
    expect(store.blobs.has(withExif)).toBe(true)
  })

  it('URL plantada em users.image (antes do #604) não entra na auditoria nem apaga o blob de outra pessoa', async () => {
    // Foto de receita de outra pessoa plantada como avatar: duas referências ⇒ fora da auditoria.
    const recipePhoto = await put('recipes', OLD, JPEG_EXIF)
    const { imageId } = await recipeWithImage(recipePhoto, 'user_photo')
    // Foto de avaliação plantada como avatar: uma referência só, mas fora de `avatars/`.
    const reviewPhoto = await put('reviews', OLD, JPEG_EXIF)
    // Avatar antigo de outra pessoa plantado numa segunda conta.
    const sharedAvatar = await put('avatars', OLD, JPEG_EXIF)
    const atacante = await seedUser({ email: 'plantou-receita@ex.com' })
    const atacante2 = await seedUser({ email: 'plantou-avaliacao@ex.com' })
    const dona = await seedUser({ email: 'avatar-dona@ex.com' })
    const atacante3 = await seedUser({ email: 'plantou-avatar@ex.com' })
    await getDb().update(users).set({ image: recipePhoto }).where(eq(users.id, atacante))
    await getDb().update(users).set({ image: reviewPhoto }).where(eq(users.id, atacante2))
    await getDb().update(users).set({ image: sharedAvatar }).where(eq(users.id, dona))
    await getDb().update(users).set({ image: sharedAvatar }).where(eq(users.id, atacante3))

    const counts = await run()
    expect(counts).toMatchObject({ fotosVerificadas: 0, fotosReencodadas: 0, apagados: 0 })
    for (const url of [recipePhoto, reviewPhoto, sharedAvatar]) expect(store.blobs.has(url)).toBe(true)
    const [img] = await getDb().select({ u: recipeImage.blobUrl }).from(recipeImage).where(eq(recipeImage.id, imageId))
    expect(img.u).toBe(recipePhoto)
  })

  it('orçamento esgotado ⇒ fotos ficam para a próxima passada (fotosRestantes)', async () => {
    const a = await put('recipes', OLD, JPEG_EXIF)
    await recipeWithImage(a, 'user_photo')
    let calls = 0
    // Libera a listagem (uma página por prefixo) e nega a primeira foto.
    const budget = { remainingMs: () => 0, canStartMore: () => calls++ < BLOB_SWEEP_PREFIXES.length }
    const counts = await sweepBlobs(getDb(), store, { now: NOW, budget })
    expect(counts).toMatchObject({ fotosVerificadas: 0, fotosRestantes: 1 })
    expect(store.blobs.has(a)).toBe(true)
  })
})

describe('GET /api/cron/blob-sweep', () => {
  const prev = { secret: process.env.CRON_SECRET, env: process.env.VERCEL_ENV }
  const authed = () =>
    new Request('http://localhost/api/cron/blob-sweep', { headers: { authorization: 'Bearer segredo-teste' } })

  beforeEach(() => {
    process.env.CRON_SECRET = 'segredo-teste'
    delete process.env.VERCEL_ENV
  })
  afterEach(() => {
    if (prev.secret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = prev.secret
    if (prev.env === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = prev.env
  })

  it('sem o secret ⇒ 401; com ele ⇒ 200 e as contagens', async () => {
    expect((await cronGET(new Request('http://localhost/api/cron/blob-sweep'))).status).toBe(401)
    await seedUser({ email: 'alguem@ex.com' })
    const orphan = await put('recipes', OLD)
    const res = await cronGET(authed())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ orfaos: 1, apagados: 1 })
    expect(store.blobs.has(orphan)).toBe(false)
  })

  it('Preview ⇒ pulada, nada apagado', async () => {
    process.env.VERCEL_ENV = 'preview'
    const orphan = await put('recipes', OLD)
    const res = await cronGET(authed())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ pulada: 1 })
    expect(store.blobs.has(orphan)).toBe(true)
  })

  it('pausa manual (BLOB_SWEEP_PAUSE=1, antes de restaurar o banco) ⇒ pulada', async () => {
    process.env.BLOB_SWEEP_PAUSE = '1'
    try {
      await seedUser({ email: 'alguem@ex.com' })
      const orphan = await put('recipes', OLD)
      await expect((await cronGET(authed())).json()).resolves.toEqual({ pulada: 1 })
      expect(store.blobs.has(orphan)).toBe(true)
    } finally {
      delete process.env.BLOB_SWEEP_PAUSE
    }
  })

  it('fora da Vercel e fora dos testes (next dev) ⇒ pulada', async () => {
    const env = process.env as Record<string, string | undefined>
    const prevNodeEnv = env.NODE_ENV
    env.NODE_ENV = 'development'
    try {
      const orphan = await put('recipes', OLD)
      await expect((await cronGET(authed())).json()).resolves.toEqual({ pulada: 1 })
      expect(store.blobs.has(orphan)).toBe(true)
    } finally {
      env.NODE_ENV = prevNodeEnv
    }
  })

  it('Blob fora do ar ⇒ 500, sem lançar', async () => {
    setImageStore(new ThrowingImageStore())
    expect((await cronGET(authed())).status).toBe(500)
  })
})
