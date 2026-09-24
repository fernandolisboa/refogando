import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { GET } from '@/app/api/cron/account-purge/route'
import { purgeAnonymizedAccounts } from '@/server/legal/account-purge-scan'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { dsarAuditEvent, recipeReview, users } from '@/db/schema'
import { seedUser } from '../helpers/users'
import { seedRecipe, seedReview } from '../helpers/recipes'

/**
 * Cron de expurgo físico pós-retenção (#411, LGPD Art. 16). Duas frentes:
 *  - `purgeAnonymizedAccounts` com `now` INJETADO (datas simuladas): remove os blobs de PII residual
 *    (foto de avaliação) das contas anonimizadas passadas da retenção, nula os ponteiros, é IDEMPOTENTE
 *    e não toca contas dentro da retenção nem URL estrangeira.
 *  - GET /api/cron/account-purge: fail-closed no `CRON_SECRET` (401 sem secret / header errado).
 *
 * `anonymized_at` é ESCRITO no passado para simular a idade — o kernel é puro, mas a escrita/varredura
 * toca o DB descartável (porta real). FakeImageStore injetado (nunca toca a rede; `.blobs` p/ asserts).
 */

const NOW = new Date('2026-07-01T09:00:00.000Z')
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const FOREIGN_URL = 'https://lh3.googleusercontent.com/a/foto-externa'

let store: FakeImageStore

beforeEach(() => {
  // Roda APÓS o resetDeps() do setup.ts global ⇒ a varredura/rota usam este Fake.
  store = new FakeImageStore()
  setImageStore(store)
})

/** Semeia um usuário ANONIMIZADO (carimba anonymized_at + deletedAt no passado). */
async function seedAnonymizedUser(anonymizedAt: Date): Promise<string> {
  const id = await seedUser({ email: `anon-${crypto.randomUUID()}@purge.test` })
  await getDb().update(users).set({ anonymizedAt, deletedAt: anonymizedAt }).where(eq(users.id, id))
  return id
}

/** Cria uma avaliação do titular com uma foto (blob no store) e devolve {reviewId, url}. */
async function seedReviewWithPhoto(userId: string, recipeId: string, url?: string) {
  const reviewId = await seedReview({ userId, recipeId, rating: 5, comment: 'ótima' })
  const photoUrl =
    url ?? (await store.store({ data: Buffer.from([1, 2, 3]), contentType: 'image/webp', pathPrefix: 'reviews' })).url
  await getDb().update(recipeReview).set({ photoUrl }).where(eq(recipeReview.id, reviewId))
  return { reviewId, url: photoUrl }
}

async function loadReviewPhoto(reviewId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ photoUrl: recipeReview.photoUrl })
    .from(recipeReview)
    .where(eq(recipeReview.id, reviewId))
  return row?.photoUrl ?? null
}

async function countPurgeEvents(): Promise<number> {
  const rows = await getDb()
    .select({ id: dsarAuditEvent.id })
    .from(dsarAuditEvent)
    .where(
      and(eq(dsarAuditEvent.eventType, 'DSAR_FULFILLED'), eq(dsarAuditEvent.requestType, 'account_purge')),
    )
  return rows.length
}

describe('purgeAnonymizedAccounts (datas simuladas via now injetado)', () => {
  it('past-retention: apaga o blob, nula o ponteiro e audita (DSAR_FULFILLED)', async () => {
    const userId = await seedAnonymizedUser(daysBefore(200)) // > 180d
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const { reviewId, url } = await seedReviewWithPhoto(userId, recipeId)
    expect(store.blobs.has(url)).toBe(true)

    const result = await purgeAnonymizedAccounts(getDb(), store, NOW)

    expect(result).toEqual({ scanned: 1, blobsReaped: 1, reviewsCleared: 1 })
    expect(store.blobs.has(url)).toBe(false) // blob de PII apagado
    expect(await loadReviewPhoto(reviewId)).toBeNull() // ponteiro nulado
    expect(await countPurgeEvents()).toBe(1) // 1 auditoria por titular expurgado
  })

  it('DENTRO da retenção: intacto (não expurga cedo, sem evento)', async () => {
    const userId = await seedAnonymizedUser(daysBefore(10)) // << 180d
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const { reviewId, url } = await seedReviewWithPhoto(userId, recipeId)

    const result = await purgeAnonymizedAccounts(getDb(), store, NOW)

    expect(result).toEqual({ scanned: 0, blobsReaped: 0, reviewsCleared: 0 })
    expect(store.blobs.has(url)).toBe(true) // blob preservado
    expect(await loadReviewPhoto(reviewId)).toBe(url) // ponteiro preservado
    expect(await countPurgeEvents()).toBe(0)
  })

  it('idempotente: 2ª varredura no mesmo now é no-op (sem 2º evento)', async () => {
    const userId = await seedAnonymizedUser(daysBefore(200))
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedReviewWithPhoto(userId, recipeId)

    const first = await purgeAnonymizedAccounts(getDb(), store, NOW)
    expect(first).toEqual({ scanned: 1, blobsReaped: 1, reviewsCleared: 1 })

    const second = await purgeAnonymizedAccounts(getDb(), store, NOW)
    // Ainda é candidato (anonymized_at segue velho), mas não há mais photo_url a nular.
    expect(second).toEqual({ scanned: 1, blobsReaped: 0, reviewsCleared: 0 })
    expect(await countPurgeEvents()).toBe(1) // nenhum evento novo
  })

  it('URL estrangeira: ponteiro nulado mas o blob externo NÃO é apagado (store.owns protege)', async () => {
    const userId = await seedAnonymizedUser(daysBefore(200))
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const { reviewId } = await seedReviewWithPhoto(userId, recipeId, FOREIGN_URL)
    expect(store.owns(FOREIGN_URL)).toBe(false)

    const result = await purgeAnonymizedAccounts(getDb(), store, NOW)

    // O ponteiro sai (deixa de referenciar PII), mas não contamos/deletamos blob estrangeiro.
    expect(result).toEqual({ scanned: 1, blobsReaped: 0, reviewsCleared: 1 })
    expect(await loadReviewPhoto(reviewId)).toBeNull()
  })
})

describe('GET /api/cron/account-purge (auth fail-closed no CRON_SECRET)', () => {
  const original = process.env.CRON_SECRET

  beforeEach(() => {
    delete process.env.CRON_SECRET
  })
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = original
  })

  const call = (headers: Record<string, string> = {}) =>
    GET(new Request('http://localhost/api/cron/account-purge', { headers }))

  it('sem CRON_SECRET no ambiente → 401 (deploy-gate humano, fecha o job)', async () => {
    const res = await call({ authorization: 'Bearer qualquer' })
    expect(res.status).toBe(401)
  })

  it('com CRON_SECRET setado mas header ausente/errado → 401', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    expect((await call()).status).toBe(401) // sem header
    expect((await call({ authorization: 'Bearer errado' })).status).toBe(401) // header errado
    expect((await call({ authorization: 'segredo-de-teste' })).status).toBe(401) // sem prefixo Bearer
  })

  it('com Bearer correto → 200 e expurga o titular anonimizado pós-retenção', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    // A rota usa `new Date()` REAL — ancoramos anonymized_at no relógio real (200 dias atrás ⇒ vencido).
    const userId = await seedAnonymizedUser(new Date(Date.now() - 200 * 86_400_000))
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const { reviewId, url } = await seedReviewWithPhoto(userId, recipeId)

    const res = await call({ authorization: 'Bearer segredo-de-teste' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scanned: number; blobsReaped: number; reviewsCleared: number }
    expect(body.scanned).toBeGreaterThanOrEqual(1)
    expect(body.reviewsCleared).toBeGreaterThanOrEqual(1)
    expect(store.blobs.has(url)).toBe(false)
    expect(await loadReviewPhoto(reviewId)).toBeNull()
  })
})
