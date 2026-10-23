import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { GET } from '@/app/api/cron/account-purge/route'
import { purgeAnonymizedAccounts, purgeAnonymizedPrivateContent } from '@/server/legal/account-purge-scan'
import { privateLeftovers } from '@/server/legal/private-content'
import { timeBudget } from '@/server/time-budget'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { collection, dsarAuditEvent, pantryItem, recipe, recipeImage, recipeReview, users } from '@/db/schema'
import { seedUser } from '../helpers/users'
import { seedCollection, seedRecipe, seedReview } from '../helpers/recipes'
import { withFailingTrigger } from '../helpers/failing-trigger'

/**
 * Cron das contas anonimizadas (#411/#473, LGPD Art. 16; ADR-0050). Três frentes:
 *  - `purgeAnonymizedAccounts` com `now` INJETADO (datas simuladas): remove os blobs de PII residual
 *    (foto de avaliação) das contas anonimizadas passadas da retenção, nula os ponteiros, é IDEMPOTENTE
 *    e não toca contas dentro da retenção nem URL estrangeira.
 *  - `purgeAnonymizedPrivateContent`: SEM espera, apaga o conteúdo privado que sobrou numa conta
 *    anonimizada (as eliminadas antes do #473 são simuladas carimbando `anonymized_at` direto), conta por
 *    conta, com isolamento de falha, lote e orçamento de tempo. A ordem do lote muda todo dia, então os
 *    testes conferem CONJUNTOS, nunca a ordem.
 *  - GET /api/cron/account-purge: fail-closed no `CRON_SECRET` (401 sem secret / header errado), a
 *    linha `[account-purge]` exata e o orçamento único da passada (`privateAccountsDeferred`).
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
    // Sem photo_url, a conta deixa de ser candidata (anonymized_at segue velho, mas não há o que expurgar).
    expect(second).toEqual({ scanned: 0, blobsReaped: 0, reviewsCleared: 0 })
    expect(await countPurgeEvents()).toBe(1) // nenhum evento novo
  })

  it('candidatas: passada da retenção SEM foto não é examinada; a COM foto, na mesma passada, é limpa', async () => {
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    // Sem foto: nem avaliação tem, ou tem avaliação sem foto. Nenhuma das duas entra em `scanned`.
    await seedAnonymizedUser(daysBefore(400))
    const noPhoto = await seedAnonymizedUser(daysBefore(300))
    const plainReview = await seedReview({ userId: noPhoto, recipeId, rating: 4, comment: 'boa' })
    const withPhoto = await seedAnonymizedUser(daysBefore(200))
    const { reviewId, url } = await seedReviewWithPhoto(withPhoto, recipeId)

    const result = await purgeAnonymizedAccounts(getDb(), store, NOW)

    expect(result).toEqual({ scanned: 1, blobsReaped: 1, reviewsCleared: 1 })
    expect(store.blobs.has(url)).toBe(false)
    expect(await loadReviewPhoto(reviewId)).toBeNull()
    expect(await loadReviewPhoto(plainReview)).toBeNull() // a avaliação sem foto segue igual
    expect(await countPurgeEvents()).toBe(1) // só a conta que tinha foto é auditada
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
  privateAccountsDeferred: 0,
  privateRecipesDeleted: 0,
  privateImagesDeleted: 0,
  privateBlobsReaped: 0,
  privateRowsDeleted: 0,
  privateRowsScrubbed: 0,
}

describe('purgeAnonymizedPrivateContent (#473 — conta eliminada não guarda conteúdo privado)', () => {
  it('conta anonimizada ONTEM é varrida já (sem espera): privado sai, público fica, um evento só com contagens', async () => {
    const legacy = await seedLegacyErased(daysBefore(1))

    const result = await purgeAnonymizedPrivateContent(getDb(), store, NOW)

    expect(result).toEqual({
      privateAccountsSwept: 1,
      privateAccountsFailed: 0,
      privateAccountsDeferred: 0,
      privateRecipesDeleted: 1,
      privateImagesDeleted: 1,
      privateBlobsReaped: 1,
      privateRowsDeleted: 1, // a coleção
      privateRowsScrubbed: 0,
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

  it('lote: `batch: 1` varre uma conta por passada; a seguinte leva a outra', async () => {
    const a = await seedLegacyErased(daysBefore(30))
    const b = await seedLegacyErased(daysBefore(2))
    const left = async () => [await hasLeftovers(a.id), await hasLeftovers(b.id)].filter(Boolean).length

    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW, { batch: 1 })).privateAccountsSwept).toBe(1)
    expect(await left()).toBe(1)

    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW, { batch: 1 })).privateAccountsSwept).toBe(1)
    expect(await left()).toBe(0)
  })

  it('orçamento de tempo: com o relógio estourado depois da 1ª conta, a passada para, conta a adiada e a seguinte retoma', async () => {
    const a = await seedLegacyErased(daysBefore(30))
    const b = await seedLegacyErased(daysBefore(2))
    // 1ª leitura = início; 2ª (antes da 1ª conta) dentro do orçamento; 3ª (antes da 2ª) já na reserva.
    const ticks = [0, 0, 26_000]
    const clock = () => ticks.shift() ?? 26_000
    const budget = timeBudget({ budgetMs: 40_000, reserveMs: 15_000, clock })

    const result = await purgeAnonymizedPrivateContent(getDb(), store, NOW, { budget })

    expect(result).toMatchObject({ privateAccountsSwept: 1, privateAccountsDeferred: 1 })
    expect([await hasLeftovers(a.id), await hasLeftovers(b.id)].sort()).toEqual([false, true])
    expect(await purgeAnonymizedPrivateContent(getDb(), store, NOW)).toMatchObject({
      privateAccountsSwept: 1,
      privateAccountsDeferred: 0,
    })
    expect([await hasLeftovers(a.id), await hasLeftovers(b.id)]).toEqual([false, false])
  })

  it('orçamento já gasto antes da 1ª conta: nada é varrido e o lote inteiro sai como adiado', async () => {
    const a = await seedLegacyErased(daysBefore(30))
    const b = await seedLegacyErased(daysBefore(2))
    const spent = timeBudget({ budgetMs: 40_000, reserveMs: 15_000, startedAt: 0, clock: () => 30_000 })

    expect(await purgeAnonymizedPrivateContent(getDb(), store, NOW, { budget: spent })).toEqual({
      ...ZERO_PRIVATE,
      privateAccountsDeferred: 2,
    })
    expect([await hasLeftovers(a.id), await hasLeftovers(b.id)]).toEqual([true, true])
    expect(await countPrivatePurgeEvents()).toBe(0)
  })
})

describe('candidatas da varredura (o predicado de todas as contas de uma vez = o de cada conta)', () => {
  /** Imagem de galeria com `created_by`, sem ser face de nada, na linhagem dada. */
  async function galleryImage(lineageId: string, createdBy: string): Promise<string> {
    const url = (await store.store({ data: Buffer.from([2]), contentType: 'image/webp', pathPrefix: 'recipes' })).url
    const [img] = await getDb()
      .insert(recipeImage)
      .values({ blobUrl: url, provenance: 'user_photo', lineageId, createdBy })
      .returning({ id: recipeImage.id })
    return img.id
  }
  async function lineageOf(recipeId: string): Promise<string> {
    const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, recipeId))
    return r.lineageId
  }

  it('fixture mista: a seleção da varredura casa com `privateLeftovers` conta a conta, e a passada zera as duas', async () => {
    // Só galeria órfã: imagem não selecionada da galeria da própria Receita pública.
    const galleryOnly = await seedAnonymizedUser(daysBefore(3))
    const pub = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: galleryOnly, visibility: 'public' })
    await galleryImage(await lineageOf(pub), galleryOnly)
    // Imagem dele, mas na galeria de uma Receita de catálogo (Curador): não é sobra.
    const curator = await seedAnonymizedUser(daysBefore(3))
    const catalog = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await galleryImage(await lineageOf(catalog), curator)
    // Imagem dele numa linhagem com Receita de outra pessoa: também não.
    const guest = await seedAnonymizedUser(daysBefore(3))
    const someoneElse = await seedUser({ email: `alheia-${crypto.randomUUID()}@purge.test` })
    const theirs = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: someoneElse, visibility: 'public' })
    await galleryImage(await lineageOf(theirs), guest)
    // Imagem dele que é a face da Receita pública dele: fica (é conteúdo público).
    const faceOnly = await seedAnonymizedUser(daysBefore(3))
    const faced = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: faceOnly, visibility: 'public' })
    const faceId = await galleryImage(await lineageOf(faced), faceOnly)
    await getDb().update(recipe).set({ imageId: faceId }).where(eq(recipe.id, faced))
    // Só uma coleção; a conta legada completa; uma conta limpa; uma conta VIVA com conteúdo privado.
    const collectionOnly = await seedAnonymizedUser(daysBefore(3))
    await seedCollection({ userId: collectionOnly, name: 'Guardadas' })
    const legacy = await seedLegacyErased(daysBefore(400))
    const clean = await seedAnonymizedUser(daysBefore(3))
    const alive = await seedUser({ email: `viva-${crypto.randomUUID()}@purge.test` })
    await seedCollection({ userId: alive, name: 'Minha' })

    const sweepSet = async () =>
      (
        await getDb()
          .select({ id: users.id })
          .from(users)
          .where(and(isNotNull(users.anonymizedAt), privateLeftovers(users.id)))
      )
        .map((r) => r.id)
        .sort()
    const perAccountSet = async () => {
      const anonymized = await getDb().select({ id: users.id }).from(users).where(isNotNull(users.anonymizedAt))
      const left: string[] = []
      for (const { id } of anonymized) if (await hasLeftovers(id)) left.push(id)
      return left.sort()
    }

    const expected = [galleryOnly, collectionOnly, legacy.id].sort()
    expect(await sweepSet()).toEqual(expected)
    expect(await perAccountSet()).toEqual(expected)
    for (const id of [curator, guest, faceOnly, clean]) expect(expected).not.toContain(id)

    expect((await purgeAnonymizedPrivateContent(getDb(), store, NOW)).privateAccountsSwept).toBe(3)
    expect(await sweepSet()).toEqual([])
    expect(await perAccountSet()).toEqual([])
    expect(await getDb().select({ userId: collection.userId }).from(collection)).toEqual([{ userId: alive }])
  })
})

describe('purgeAnonymizedPrivateContent — falha de uma conta não derruba as outras', () => {
  // O trigger reprova apagar QUALQUER linha da Despensa: só a conta que tem Despensa falha.
  const withPantryDeleteFailing = (fn: () => Promise<void>) => withFailingTrigger('pantry_item', fn)

  it('a conta que falha fica intacta e é contada; a outra é varrida; a linha de erro não leva id', async () => {
    const failing = await seedLegacyErased(daysBefore(30))
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
        '[account-purge] passada com falha: pendingSignupsPurged=0 scanned=0 blobsReaped=0 reviewsCleared=0 privateAccountsSwept=0 privateAccountsFailed=1 privateAccountsDeferred=0 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 privateRowsScrubbed=0',
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
        '[account-purge] passada concluída: pendingSignupsPurged=0 scanned=0 blobsReaped=0 reviewsCleared=0 privateAccountsSwept=0 privateAccountsFailed=0 privateAccountsDeferred=0 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 privateRowsScrubbed=0',
      ])
    } finally {
      info.mockRestore()
    }
  })

  it('passada normal: varre a conta eliminada e a linha diz `privateAccountsDeferred=0`', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    // A rota usa o relógio real: anonimizada há 2 dias (no relógio real) basta, sem espera.
    const legacy = await seedLegacyErased(new Date(Date.now() - 2 * 86_400_000))
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      expect((await call({ authorization: 'Bearer segredo-de-teste' })).status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        '[account-purge] passada concluída: pendingSignupsPurged=0 scanned=0 blobsReaped=0 reviewsCleared=0 privateAccountsSwept=1 privateAccountsFailed=0 privateAccountsDeferred=0 privateRecipesDeleted=1 privateImagesDeleted=1 privateBlobsReaped=1 privateRowsDeleted=1 privateRowsScrubbed=0',
      )
      expect(await hasLeftovers(legacy.id)).toBe(false)
    } finally {
      info.mockRestore()
    }
  })

  it('orçamento gasto pelas etapas anteriores: o privado fica para amanhã (`privateAccountsDeferred`), o cadastro pendente sai e a linha sai', async () => {
    process.env.CRON_SECRET = 'segredo-de-teste'
    const a = await seedLegacyErased(new Date(Date.now() - 2 * 86_400_000))
    const b = await seedLegacyErased(new Date(Date.now() - 3 * 86_400_000))
    // Cadastro pendente abandonado há 72 h (relógio real): a promessa das 48 h não depende do orçamento.
    const pending = await seedUser({ email: `pendente-${crypto.randomUUID()}@purge.test`, emailVerified: false })
    await getDb()
      .update(users)
      .set({ pendingSignupAt: new Date(Date.now() - 72 * 3_600_000) })
      .where(eq(users.id, pending))
    // 1ª leitura do relógio = começo da rota; da 2ª em diante, o orçamento já passou (as etapas antes do
    // privado o "gastaram").
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(1_000_000)
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const res = await call({ authorization: 'Bearer segredo-de-teste' })
      expect(res.status).toBe(200)
      expect(info).toHaveBeenCalledWith(
        '[account-purge] passada concluída: pendingSignupsPurged=1 scanned=0 blobsReaped=0 reviewsCleared=0 privateAccountsSwept=0 privateAccountsFailed=0 privateAccountsDeferred=2 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 privateRowsScrubbed=0',
      )
    } finally {
      now.mockRestore()
      info.mockRestore()
    }
    expect([await hasLeftovers(a.id), await hasLeftovers(b.id)]).toEqual([true, true])
    expect(await getDb().select({ id: users.id }).from(users).where(eq(users.id, pending))).toEqual([])
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
      expect(await res.json()).toEqual({ pendingSignupsPurged: 0, ...ZERO_PRIVATE })
      expect(error).toHaveBeenCalledWith('[account-purge] expurgo de contas anonimizadas falhou: erro=Error')
      expect(warn).toHaveBeenCalledWith(
        '[account-purge] passada com falha: pendingSignupsPurged=0 privateAccountsSwept=0 privateAccountsFailed=0 privateAccountsDeferred=0 privateRecipesDeleted=0 privateImagesDeleted=0 privateBlobsReaped=0 privateRowsDeleted=0 privateRowsScrubbed=0',
      )
    } finally {
      vi.restoreAllMocks()
    }
  })
})
