import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { GET } from '@/app/api/cron/account-purge/route'
import { purgeAnonymizedAccounts, purgeAnonymizedPrivateContent } from '@/server/legal/account-purge-scan'
import { privateLeftovers } from '@/server/legal/private-content'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { collection, dsarAuditEvent, pantryItem, recipe, recipeImage, recipeReview, users } from '@/db/schema'
import { seedUser } from '../helpers/users'
import { seedCollection, seedRecipe, seedReview } from '../helpers/recipes'

/**
 * Cron das contas anonimizadas (#411/#473, LGPD Art. 16; ADR-0049). Três frentes:
 *  - `purgeAnonymizedAccounts` com `now` INJETADO (datas simuladas): remove os blobs de PII residual
 *    (foto de avaliação) das contas anonimizadas passadas da retenção, nula os ponteiros, é IDEMPOTENTE
 *    e não toca contas dentro da retenção nem URL estrangeira.
 *  - `purgeAnonymizedPrivateContent`: SEM espera, apaga o conteúdo privado que sobrou numa conta
 *    anonimizada (as eliminadas antes do #473 são simuladas carimbando `anonymized_at` direto), conta por
 *    conta, com isolamento de falha, lote e orçamento de tempo.
 *  - GET /api/cron/account-purge: fail-closed no `CRON_SECRET` (401 sem secret / header errado) e a
 *    linha `[account-purge]` exata.
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

/** Conta eliminada ANTES do #473: anonimizada, com o conteúdo privado que a eliminação de então mantinha. */
async function seedLegacyErased(anonymizedAt: Date) {
  const id = await seedAnonymizedUser(anonymizedAt)
  const privateRecipe = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: id, visibility: 'private' })
  const publicRecipe = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: id, visibility: 'public' })
  const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, privateRecipe))
  const face = (await store.store({ data: Buffer.from([1]), contentType: 'image/webp', pathPrefix: 'recipes' })).url
  const [img] = await getDb()
    .insert(recipeImage)
    .values({ blobUrl: face, provenance: 'user_photo', lineageId: r.lineageId, createdBy: id })
    .returning({ id: recipeImage.id })
  await getDb().update(recipe).set({ imageId: img.id }).where(eq(recipe.id, privateRecipe))
  await seedCollection({ userId: id, name: 'Guardadas' })
  return { id, privateRecipe, publicRecipe, face }
}

async function hasLeftovers(id: string): Promise<boolean> {
  const [r] = await getDb().select({ left: sql<boolean>`${privateLeftovers(id)}` }).from(users).where(eq(users.id, id))
  return r.left
}

async function countPrivatePurgeEvents(): Promise<number> {
  const rows = await getDb()
    .select({ id: dsarAuditEvent.id })
    .from(dsarAuditEvent)
    .where(and(eq(dsarAuditEvent.eventType, 'DSAR_FULFILLED'), eq(dsarAuditEvent.requestType, 'account_private_purge')))
  return rows.length
}

const ZERO_PRIVATE = {
  privateAccountsSwept: 0,
  privateAccountsFailed: 0,
  privateRecipesDeleted: 0,
  privateImagesDeleted: 0,
  privateBlobsReaped: 0,
  privateRowsDeleted: 0,
}

describe('purgeAnonymizedPrivateContent (#473 — conta eliminada não guarda conteúdo privado)', () => {
  it('conta anonimizada ONTEM é varrida já (sem espera): privado sai, público fica, um evento só com contagens', async () => {
    const legacy = await seedLegacyErased(daysBefore(1))

    const result = await purgeAnonymizedPrivateContent(getDb(), store, NOW)

    expect(result).toEqual({
      privateAccountsSwept: 1,
      privateAccountsFailed: 0,
      privateRecipesDeleted: 1,
      privateImagesDeleted: 1,
      privateBlobsReaped: 1,
      privateRowsDeleted: 1, // a coleção
    })
    expect(await getDb().select({ id: recipe.id }).from(recipe)).toEqual([{ id: legacy.publicRecipe }])
    expect(store.blobs.has(legacy.face)).toBe(false)
    expect(await getDb().select().from(collection)).toEqual([])
    expect(await hasLeftovers(legacy.id)).toBe(false)
    const events = await getDb()
      .select({ actorId: dsarAuditEvent.actorId, channel: dsarAuditEvent.channel, details: dsarAuditEvent.details })
      .from(dsarAuditEvent)
      .where(eq(dsarAuditEvent.requestType, 'account_private_purge'))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ actorId: null, channel: 'system', details: { recipes: 1, images: 1, collections: 1 } })
    expect(JSON.stringify(events[0].details)).not.toContain(legacy.privateRecipe)
  })

  it('idempotente: a 2ª passada não acha nada e não grava 2º evento', async () => {
    await seedLegacyErased(daysBefore(400))
    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW)).privateAccountsSwept).toBe(1)

    expect(await purgeAnonymizedPrivateContent(getDb(), store, NOW)).toEqual(ZERO_PRIVATE)
    expect(await countPrivatePurgeEvents()).toBe(1)
  })

  it('conta VIVA nunca é tocada, mesmo com conteúdo privado', async () => {
    const alive = await seedUser({ email: 'viva@purge.test' })
    const r = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: alive, visibility: 'private' })
    await seedCollection({ userId: alive, name: 'Minha' })

    expect(await purgeAnonymizedPrivateContent(getDb(), store, NOW)).toEqual(ZERO_PRIVATE)
    expect(await getDb().select({ id: recipe.id }).from(recipe)).toEqual([{ id: r }])
    expect(await getDb().select({ userId: collection.userId }).from(collection)).toEqual([{ userId: alive }])
    expect(await countPrivatePurgeEvents()).toBe(0)
  })

  it('lote: `batch: 1` varre uma conta por passada, a mais antiga primeiro', async () => {
    const older = await seedLegacyErased(daysBefore(30))
    const newer = await seedLegacyErased(daysBefore(2))

    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW, { batch: 1 })).privateAccountsSwept).toBe(1)
    expect(await hasLeftovers(older.id)).toBe(false)
    expect(await hasLeftovers(newer.id)).toBe(true)

    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW, { batch: 1 })).privateAccountsSwept).toBe(1)
    expect(await hasLeftovers(newer.id)).toBe(false)
  })

  it('orçamento de tempo: com o relógio estourado depois da 1ª conta, a passada para e a seguinte retoma', async () => {
    const first = await seedLegacyErased(daysBefore(30))
    const second = await seedLegacyErased(daysBefore(2))
    // 1ª leitura = início; 2ª (antes da 1ª conta) dentro do orçamento; 3ª (antes da 2ª) já na reserva.
    const ticks = [0, 0, 26_000]
    const clock = () => ticks.shift() ?? 26_000

    const result = await purgeAnonymizedPrivateContent(getDb(), store, NOW, { budgetMs: 40_000, reserveMs: 15_000, clock })

    expect(result.privateAccountsSwept).toBe(1)
    expect(await hasLeftovers(first.id)).toBe(false)
    expect(await hasLeftovers(second.id)).toBe(true)
    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW)).privateAccountsSwept).toBe(1)
    expect(await hasLeftovers(second.id)).toBe(false)
  })
})

describe('purgeAnonymizedPrivateContent — falha de uma conta não derruba as outras', () => {
  // Trigger que reprova apagar QUALQUER linha da Despensa: só a conta que tem Despensa falha.
  async function withPantryDeleteFailing(fn: () => Promise<void>): Promise<void> {
    await getDb().execute(
      sql.raw(`CREATE FUNCTION test_falha_despensa() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de teste'; END $$`),
    )
    await getDb().execute(
      sql.raw('CREATE TRIGGER test_falha_despensa BEFORE DELETE ON pantry_item FOR EACH ROW EXECUTE FUNCTION test_falha_despensa()'),
    )
    try {
      await fn()
    } finally {
      await getDb().execute(sql.raw('DROP TRIGGER IF EXISTS test_falha_despensa ON pantry_item'))
      await getDb().execute(sql.raw('DROP FUNCTION IF EXISTS test_falha_despensa()'))
    }
  }

  it('a conta que falha fica intacta e é contada; a outra é varrida; a linha de erro não leva id', async () => {
    const failing = await seedLegacyErased(daysBefore(30)) // a mais antiga: vem primeiro
    await getDb().insert(pantryItem).values({ userId: failing.id, nome: 'arroz', matchKey: 'arroz' })
    const ok = await seedLegacyErased(daysBefore(2))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await withPantryDeleteFailing(async () => {
        const result = await purgeAnonymizedPrivateContent(getDb(), store, NOW)
        expect(result).toMatchObject({ privateAccountsSwept: 1, privateAccountsFailed: 1, privateRecipesDeleted: 1 })
      })
      expect(error.mock.calls).toEqual([
        ['[account-purge] conteúdo privado de uma conta anonimizada falhou: erro=Error codigo=P0001'],
      ])
      // Tudo ou nada por conta: a que falhou mantém a Receita privada e a face (blob inclusive).
      expect(await getDb().select({ id: recipe.id }).from(recipe).where(eq(recipe.id, failing.privateRecipe))).toHaveLength(1)
      expect(store.blobs.has(failing.face)).toBe(true)
      expect(await hasLeftovers(ok.id)).toBe(false)
    } finally {
      error.mockRestore()
    }
  })

  it('pela rota: a conta que falha ⇒ 500 e warn "com falha" com as contagens', async () => {
    const original = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'segredo-de-teste'
    // A rota usa o relógio real: anonimizada há 2 dias (no relógio real) basta, sem espera.
    const failing = await seedLegacyErased(new Date(Date.now() - 2 * 86_400_000))
    await getDb().insert(pantryItem).values({ userId: failing.id, nome: 'arroz', matchKey: 'arroz' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await withPantryDeleteFailing(async () => {
        const res = await GET(
          new Request('http://localhost/api/cron/account-purge', { headers: { authorization: 'Bearer segredo-de-teste' } }),
        )
        expect(res.status).toBe(500)
      })
      expect(warn).toHaveBeenCalledWith(
        '[account-purge] passada com falha: scanned=0 blobsReaped=0 reviewsCleared=0 privateAccountsSwept=0 privateAccountsFailed=1 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 pendingSignupsPurged=0',
      )
      const logged = [...error.mock.calls, ...warn.mock.calls].flat().map(String).join(' ')
      expect(logged).not.toContain(failing.id)
    } finally {
      error.mockRestore()
      warn.mockRestore()
      if (original === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = original
    }
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

  it('cada passada deixa UMA linha [account-purge] com as contagens (só números)', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const res = await call({ authorization: 'Bearer segredo-de-teste' })
      expect(res.status).toBe(200)
      const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[account-purge]'))
      expect(lines).toEqual([
        '[account-purge] passada concluída: scanned=0 blobsReaped=0 reviewsCleared=0 privateAccountsSwept=0 privateAccountsFailed=0 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 pendingSignupsPurged=0',
      ])
    } finally {
      info.mockRestore()
    }
  })

  it('uma varredura falha → 500, a outra roda, e a linha sai como warn "com falha" só com as contagens dela', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    const userId = await seedAnonymizedUser(new Date(Date.now() - 200 * 86_400_000))
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedReviewWithPhoto(userId, recipeId)
    vi.spyOn(store, 'owns').mockImplementation(() => {
      throw new Error('store fora do ar')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await call({ authorization: 'Bearer segredo-de-teste' })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        privateAccountsSwept: 0,
        privateAccountsFailed: 0,
        privateRecipesDeleted: 0,
        privateImagesDeleted: 0,
        privateBlobsReaped: 0,
        privateRowsDeleted: 0,
        pendingSignupsPurged: 0,
      })
      expect(error).toHaveBeenCalledWith('[account-purge] expurgo de contas anonimizadas falhou: Error')
      expect(warn).toHaveBeenCalledWith(
        '[account-purge] passada com falha: privateAccountsSwept=0 privateAccountsFailed=0 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 pendingSignupsPurged=0',
      )
    } finally {
      vi.restoreAllMocks()
    }
  })
})
