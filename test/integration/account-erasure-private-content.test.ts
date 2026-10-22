import { beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '@/db/schema'
import {
  briefing,
  briefingItem,
  collection,
  collectionItem,
  creationSession,
  dsarAuditEvent,
  generation,
  mealPlanEntry,
  notification,
  pantryItem,
  recipe,
  recipeEmbedding,
  recipeImage,
  recipeReview,
  recipeSave,
  recipeTag,
  recipeTranslation,
  report,
  shoppingList,
  shoppingListItem,
  transcriptMessage,
  userFollow,
  users,
} from '@/db/schema'
import { getDb, setImageStore } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { eraseOwnAccount } from '@/server/legal/account-erasure'
import { ERASURE_POLICY, privateLeftovers } from '@/server/legal/private-content'
import { persistGeneration } from '@/server/generation/persist'
import { loadAiCostSummary } from '@/server/admin/ai-cost'
import { promptStampFor } from '@/domain/briefing'
import { DEFAULT_TEXT_MODEL } from '@/domain/claude-models'
import {
  seedCollection,
  seedCollectionItem,
  seedEmbedding,
  seedRecipe,
  seedRecipeTag,
  seedReport,
  seedReview,
  seedSave,
  seedTranslation,
} from '../helpers/recipes'
import { seedUser } from '../helpers/users'
import { makeReceita } from '../helpers/generation'

/**
 * Eliminação da conta: o conteúdo PRIVADO sai, o PÚBLICO fica (#473, ADR-0049). Postgres real; o
 * `FakeImageStore` guarda os blobs para provar o que foi apagado depois do commit (e o que nunca é: URL
 * estrangeira, face compartilhada, galeria do catálogo). O contrato da rota está em `me-erasure.test.ts`.
 */

let store: FakeImageStore
beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
})

const FOREIGN_URL = 'https://lh3.googleusercontent.com/a/foto-alheia'

async function blob(prefix = 'recipes'): Promise<string> {
  return (await store.store({ data: Buffer.from(prefix), contentType: 'image/webp', pathPrefix: prefix })).url
}

async function lineageOf(recipeId: string): Promise<string> {
  const [r] = await getDb().select({ lineageId: recipe.lineageId }).from(recipe).where(eq(recipe.id, recipeId))
  return r.lineageId
}

/** Imagem da galeria com os três blobs (original + derivados) e `created_by` explícito. */
async function seedImage(input: {
  lineageId: string
  createdBy: string | null
  face?: string
  blobUrl?: string
  derivatives?: boolean
}): Promise<{ id: string; urls: string[] }> {
  const blobUrl = input.blobUrl ?? (await blob())
  const derivatives = input.derivatives ?? true
  const thumbUrl = derivatives ? await blob('recipes/w640') : null
  const detailUrl = derivatives ? await blob('recipes/w1280') : null
  const [img] = await getDb()
    .insert(recipeImage)
    .values({ blobUrl, thumbUrl, detailUrl, provenance: 'user_photo', lineageId: input.lineageId, createdBy: input.createdBy })
    .returning({ id: recipeImage.id })
  if (input.face) await getDb().update(recipe).set({ imageId: img.id }).where(eq(recipe.id, input.face))
  return { id: img.id, urls: [blobUrl, thumbUrl, detailUrl].filter((u): u is string => u != null) }
}

async function exists(table: PgTable, where: SQL): Promise<boolean> {
  const rows = await getDb().select({ one: sql`1` }).from(table).where(where).limit(1)
  return rows.length > 0
}

async function hasLeftovers(userId: string): Promise<boolean> {
  const [r] = await getDb()
    .select({ left: sql<boolean>`${privateLeftovers(userId)}` })
    .from(users)
    .where(eq(users.id, userId))
  return r.left
}

describe('eliminação: Receitas privadas', () => {
  it('privadas (ia, importada da web, lúdica) saem com tradução, tags e embedding; a pública fica', async () => {
    const u = await seedUser({ email: 'privadas@pc.test' })
    const ai = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    const web = await seedRecipe({ origin: 'web_imported', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    const playful = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: u,
      visibility: 'private',
      resultKind: 'playful',
    })
    const pub = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'public' })
    await seedTranslation({ recipeId: ai, locale: 'pt-BR', titulo: 'Segredo de família', provenance: 'escrita_por_pessoa' })
    await seedRecipeTag(ai, 'segredo')
    await seedEmbedding({ recipeId: ai, locale: 'pt-BR' })
    // Outra conta, intocada (sem IDOR).
    const other = await seedUser({ email: 'outra@pc.test' })
    const othersPrivate = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: other, visibility: 'private' })

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')

    const left = await getDb().select({ id: recipe.id }).from(recipe).where(inArray(recipe.id, [ai, web, playful, pub, othersPrivate]))
    expect(left.map((r) => r.id).sort()).toEqual([pub, othersPrivate].sort())
    expect(await exists(recipeTranslation, eq(recipeTranslation.recipeId, ai))).toBe(false)
    expect(await exists(recipeTag, eq(recipeTag.recipeId, ai))).toBe(false)
    expect(await exists(recipeEmbedding, eq(recipeEmbedding.recipeId, ai))).toBe(false)
    expect(await hasLeftovers(u)).toBe(false)
  })

  it('privada que já foi pública: save e avaliação de terceiro saem (e a foto da avaliação), a derivada do terceiro fica sem o ponteiro', async () => {
    const u = await seedUser({ email: 'ex-publica@pc.test' })
    const t = await seedUser({ email: 'terceiro@pc.test' })
    const r = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    await seedSave({ userId: t, recipeId: r })
    const reviewId = await seedReview({ userId: t, recipeId: r, rating: 5 })
    const photo = await blob('reviews')
    await getDb().update(recipeReview).set({ photoUrl: photo }).where(eq(recipeReview.id, reviewId))
    const derived = await seedRecipe({
      origin: 'user_edited',
      originalLocale: 'pt-BR',
      ownerId: t,
      visibility: 'private',
      parentRecipeId: r,
      lineageKind: 'edited',
    })

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')

    expect(await exists(recipe, eq(recipe.id, r))).toBe(false)
    expect(await exists(recipeSave, eq(recipeSave.recipeId, r))).toBe(false)
    expect(await exists(recipeReview, eq(recipeReview.id, reviewId))).toBe(false)
    expect(store.blobs.has(photo)).toBe(false)
    const [d] = await getDb().select({ parent: recipe.parentRecipeId }).from(recipe).where(eq(recipe.id, derived))
    expect(d).toEqual({ parent: null })
  })
})

describe('eliminação: imagens', () => {
  it('face compartilhada com a versão pública FICA; galeria sem referência sai com os 3 blobs; catálogo e URL estrangeira protegidos', async () => {
    const u = await seedUser({ email: 'imagens@pc.test', role: 'curador' })
    // Linhagem pública: a versão pública e a privada (carry-forward da regeneração) compartilham a face.
    const pub = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'public' })
    const lineage = await lineageOf(pub)
    const priv = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    await getDb().update(recipe).set({ lineageId: lineage }).where(eq(recipe.id, priv))
    const shared = await seedImage({ lineageId: lineage, createdBy: u, face: pub })
    await getDb().update(recipe).set({ imageId: shared.id }).where(eq(recipe.id, priv))
    // Imagem NÃO selecionada da galeria pública: conteúdo privado (a galeria é só do dono).
    const unselected = await seedImage({ lineageId: lineage, createdBy: u })
    // Receita privada com linhagem própria: a face e uma imagem da galeria sem `created_by` (ex.: legada).
    const solo = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    const soloLineage = await lineageOf(solo)
    const soloFace = await seedImage({ lineageId: soloLineage, createdBy: u, face: solo })
    const soloGallery = await seedImage({ lineageId: soloLineage, createdBy: null })
    // Curador: imagem dele na galeria de uma Receita de CATÁLOGO, não selecionada.
    const catalog = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const curatorImage = await seedImage({ lineageId: await lineageOf(catalog), createdBy: u })
    // URL estrangeira numa imagem dele sem referência: a linha sai, o blob alheio nunca é tocado.
    const foreign = await seedImage({ lineageId: lineage, createdBy: u, blobUrl: FOREIGN_URL, derivatives: false })
    const del = vi.spyOn(store, 'delete')

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')

    const rows = await getDb().select({ id: recipeImage.id }).from(recipeImage)
    expect(rows.map((r) => r.id).sort()).toEqual([shared.id, curatorImage.id].sort())
    for (const url of [...shared.urls, ...curatorImage.urls]) expect(store.blobs.has(url)).toBe(true)
    for (const url of [...unselected.urls, ...soloFace.urls, ...soloGallery.urls]) expect(store.blobs.has(url)).toBe(false)
    expect(del.mock.calls.map((c) => c[0])).not.toContain(FOREIGN_URL)
    expect(await exists(recipeImage, eq(recipeImage.id, foreign.id))).toBe(false)
    const [p] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, pub))
    expect(p.imageId).toBe(shared.id)
    expect(await hasLeftovers(u)).toBe(false)
  })
})

describe('eliminação: sessões de criação (limpa o texto, mantém o casco do ledger)', () => {
  it('Transcrição, texto livre, comentário, carimbo e Briefing somem; gerações, custo e sessões ficam; o painel de custo não muda', async () => {
    const u = await seedUser({ email: 'sessoes@pc.test' })
    const usage = { inputTokens: 1200, outputTokens: 800 }
    const stamp = promptStampFor()
    const conv = await persistGeneration({
      result: { outcome: 'success', recipe: makeReceita(), advisory: 'dica da conversa' },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: u,
      model: DEFAULT_TEXT_MODEL,
      promptStamp: stamp,
      usage,
    })
    await getDb()
      .insert(transcriptMessage)
      .values([
        { creationSessionId: conv!.creationSessionId, role: 'user', content: 'minha avó fazia assim', seq: 0 },
        { creationSessionId: conv!.creationSessionId, role: 'assistant', content: 'que bonito', seq: 1 },
      ])
    const structured = await persistGeneration({
      result: { outcome: 'impossible', advisory: 'não dá com esses ingredientes' },
      mode: 'structured',
      origin: 'ai_structured',
      ownerId: u,
      model: DEFAULT_TEXT_MODEL,
      briefing: {
        cozinha: 'brasileira',
        restricoes: ['sem_gluten'],
        porcoes: 4,
        observacoes: 'sou alérgica a camarão',
        itens: [{ ingredientId: null, rawText: 'mandioca', quantidade: '1.000', unidade: 'kg', strength: 'required', ordem: 0 }],
      },
      promptStamp: stamp,
      usage,
    })
    const free = await persistGeneration({
      result: { outcome: 'success', recipe: makeReceita(), advisory: null },
      mode: 'free_text',
      origin: 'ai_free_text',
      ownerId: u,
      model: DEFAULT_TEXT_MODEL,
      freeText: 'bolo pro aniversário do meu filho',
      usage,
    })
    const costBefore = await loadAiCostSummary(getDb())
    const userCost = (s: typeof costBefore) => s.topUsers.find((x) => x.userId === u)?.totalUsd
    expect(costBefore.totals.textUsd).toBeGreaterThan(0)
    const generationsBefore = await getDb()
      .select({ id: generation.id, costUsd: generation.costUsd, inputTokens: generation.inputTokens })
      .from(generation)
      .orderBy(generation.id)

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')

    expect(await getDb().select().from(transcriptMessage)).toEqual([])
    const sessions = await getDb()
      .select({ id: creationSession.id, freeText: creationSession.freeText, briefingId: creationSession.briefingId })
      .from(creationSession)
    expect(sessions.map((s) => s.id).sort()).toEqual(
      [conv!.creationSessionId, structured!.creationSessionId, free!.creationSessionId].sort(),
    )
    expect(sessions.every((s) => s.freeText === null)).toBe(true)
    const gens = await getDb()
      .select({
        id: generation.id,
        costUsd: generation.costUsd,
        inputTokens: generation.inputTokens,
        advisory: generation.advisoryComment,
        stamp: generation.promptStamp,
      })
      .from(generation)
      .orderBy(generation.id)
    expect(gens.map(({ id, costUsd, inputTokens }) => ({ id, costUsd, inputTokens }))).toEqual(generationsBefore)
    expect(gens.every((g) => g.advisory === null && g.stamp === null)).toBe(true)
    const [b] = await getDb().select().from(briefing).where(eq(briefing.id, structured!.briefingId!))
    expect([b.cozinha, b.restricoes, b.porcoes, b.dificuldade, b.observacoes]).toEqual([null, [], null, null, null])
    expect(await getDb().select().from(briefingItem)).toEqual([])

    const costAfter = await loadAiCostSummary(getDb())
    expect(costAfter.totals).toEqual(costBefore.totals)
    expect(costAfter.perDay).toEqual(costBefore.perDay)
    expect(userCost(costAfter)).toBe(userCost(costBefore))
    expect(await hasLeftovers(u)).toBe(false)
  })
})

describe('eliminação: o resto do conteúdo privado', () => {
  it('saves, coleções, listas, follows, notificações recebidas, Plano e Despensa saem; avaliações, denúncias e notificações como ator ficam', async () => {
    const u = await seedUser({ email: 'resto@pc.test' })
    const t = await seedUser({ email: 'resto-t@pc.test' })
    const theirs = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: t, visibility: 'public' })
    await seedSave({ userId: u, recipeId: theirs })
    const col = await seedCollection({ userId: u, name: 'Favoritas' })
    await seedCollectionItem({ collectionId: col, recipeId: theirs })
    const [list] = await getDb().insert(shoppingList).values({ userId: u, name: 'Mercado' }).returning({ id: shoppingList.id })
    await getDb().insert(shoppingListItem).values({ listId: list.id, nome: 'ovo', matchKey: 'ovo' })
    await getDb()
      .insert(userFollow)
      .values([
        { followerId: u, followeeId: t },
        { followerId: t, followeeId: u },
      ])
    await getDb()
      .insert(notification)
      .values([
        { recipientId: u, type: 'new_follower', actorId: t },
        { recipientId: t, type: 'new_follower', actorId: u },
      ])
    await getDb().insert(mealPlanEntry).values({ userId: u, day: '2026-10-22', slot: 'almoco', recipeId: theirs })
    await getDb().insert(pantryItem).values({ userId: u, nome: 'arroz', matchKey: 'arroz' })
    const review = await seedReview({ userId: u, recipeId: theirs, rating: 4, comment: 'boa' })
    const filed = await seedReport({ recipeId: theirs, reporterId: u })

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')

    expect(await exists(recipeSave, eq(recipeSave.userId, u))).toBe(false)
    expect(await exists(collection, eq(collection.userId, u))).toBe(false)
    expect(await exists(collectionItem, eq(collectionItem.collectionId, col))).toBe(false)
    expect(await exists(shoppingList, eq(shoppingList.userId, u))).toBe(false)
    expect(await exists(shoppingListItem, eq(shoppingListItem.listId, list.id))).toBe(false)
    expect(await getDb().select().from(userFollow)).toEqual([])
    expect(await exists(notification, eq(notification.recipientId, u))).toBe(false)
    expect(await exists(notification, and(eq(notification.recipientId, t), eq(notification.actorId, u))!)).toBe(true)
    expect(await exists(mealPlanEntry, eq(mealPlanEntry.userId, u))).toBe(false)
    expect(await exists(pantryItem, eq(pantryItem.userId, u))).toBe(false)
    expect(await exists(recipeReview, eq(recipeReview.id, review))).toBe(true)
    expect(await exists(report, eq(report.id, filed))).toBe(true)
    // A Receita do terceiro e o save de outra pessoa nela não são tocados.
    expect(await exists(recipe, eq(recipe.id, theirs))).toBe(true)
    expect(await hasLeftovers(u)).toBe(false)
  })

  it('auditoria: DSAR_RECEIVED com as CONTAGENS do que saiu, nunca ids', async () => {
    const u = await seedUser({ email: 'auditoria@pc.test' })
    const r = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    await seedCollection({ userId: u, name: 'Minha' })

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')

    const [ev] = await getDb()
      .select({ details: dsarAuditEvent.details })
      .from(dsarAuditEvent)
      .where(and(eq(dsarAuditEvent.actorId, u), eq(dsarAuditEvent.requestType, 'account_erasure')))
    expect(ev.details).toEqual({
      anonymized: true,
      sessionsRevoked: 0,
      recipes: 1,
      images: 0,
      reviewPhotos: 0,
      transcriptMessages: 0,
      sessionsScrubbed: 0,
      generationsScrubbed: 0,
      briefingsScrubbed: 0,
      briefingItems: 0,
      collections: 1,
      saves: 0,
      shoppingLists: 0,
      follows: 0,
      notifications: 0,
      mealPlanEntries: 0,
      pantryItems: 0,
    })
    expect(JSON.stringify(ev.details)).not.toContain(r)
  })
})

describe('eliminação: atomicidade e blobs depois do commit', () => {
  it('falha no meio da limpeza ⇒ NADA muda: a conta não é anonimizada e a Receita privada fica', async () => {
    const u = await seedUser({ email: 'atomica@pc.test' })
    const r = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    const face = await seedImage({ lineageId: await lineageOf(r), createdBy: u, face: r })
    await getDb().execute(
      sql.raw(`CREATE FUNCTION test_falha_follow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de teste'; END $$`),
    )
    await getDb().execute(
      sql.raw('CREATE TRIGGER test_falha_follow BEFORE DELETE ON user_follow FOR EACH STATEMENT EXECUTE FUNCTION test_falha_follow()'),
    )
    try {
      await expect(eraseOwnAccount(getDb(), { userId: u })).rejects.toThrow()
    } finally {
      await getDb().execute(sql.raw('DROP TRIGGER IF EXISTS test_falha_follow ON user_follow'))
      await getDb().execute(sql.raw('DROP FUNCTION IF EXISTS test_falha_follow()'))
    }

    const [row] = await getDb()
      .select({ deletedAt: users.deletedAt, anonymizedAt: users.anonymizedAt, email: users.email })
      .from(users)
      .where(eq(users.id, u))
    expect(row).toEqual({ deletedAt: null, anonymizedAt: null, email: 'atomica@pc.test' })
    expect(await exists(recipe, eq(recipe.id, r))).toBe(true)
    expect(await exists(recipeImage, eq(recipeImage.id, face.id))).toBe(true)
    for (const url of face.urls) expect(store.blobs.has(url)).toBe(true)
  })

  it('o store recusa apagar ⇒ ainda `erased` e as linhas já saíram (o blob vira órfão tolerável)', async () => {
    const u = await seedUser({ email: 'store-falha@pc.test' })
    const r = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    const face = await seedImage({ lineageId: await lineageOf(r), createdBy: u, face: r })
    vi.spyOn(store, 'delete').mockRejectedValue(new Error('blob fora do ar'))

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')
    expect(await exists(recipe, eq(recipe.id, r))).toBe(false)
    expect(await exists(recipeImage, eq(recipeImage.id, face.id))).toBe(false)
  })

  it('`store.owns` que lança depois do commit ⇒ ainda `erased` (não vira 500)', async () => {
    const u = await seedUser({ email: 'owns-falha@pc.test' })
    const r = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: u, visibility: 'private' })
    await seedImage({ lineageId: await lineageOf(r), createdBy: u, face: r })
    await getDb().update(users).set({ image: await blob('avatars') }).where(eq(users.id, u))
    vi.spyOn(store, 'owns').mockImplementation(() => {
      throw new Error('owns quebrou')
    })

    expect((await eraseOwnAccount(getDb(), { userId: u })).kind).toBe('erased')
    expect(await exists(recipe, eq(recipe.id, r))).toBe(false)
  })
})

describe('ERASURE_POLICY', () => {
  it('classifica TODA FK para users (qualquer onDelete): FK nova reprova até alguém decidir o destino dela', () => {
    const name = (t: PgTable) => getTableConfig(t).name
    const fks = new Set<string>()
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue
      for (const fk of getTableConfig(value).foreignKeys) {
        const ref = fk.reference()
        if (name(ref.foreignTable) === 'users') fks.add(`${name(value)}.${ref.columns[0].name}`)
      }
    }
    expect(new Set(Object.keys(ERASURE_POLICY))).toEqual(fks)
  })
})
