import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient, setEmbedder, setImageGenerator, setImageStore } from '@/server/deps'
import {
  ClaudeProviderUnavailableError,
  FakeClaudeClient,
  type ConversationStreamInput,
} from '@/server/claude/client'
import { FakeEmbedder } from '@/server/embedding/embedder'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator, ThrowingImageGenerator } from '@/server/images/image-generator'
import { POST as imageGenerate } from '@/app/api/recipes/[id]/image/generate/route'
import { POST as regenerateRoute } from '@/app/api/recipes/[id]/regenerate/route'
import { POST as streamRoute } from '@/app/api/conversations/stream/route'
import {
  appConfig,
  creationSession,
  generation,
  imageGeneration,
  quotaHold,
} from '@/db/schema'
import { DEFAULT_RECIPE_VARIANT_CONFIG } from '@/domain/recipe-variant-config'
import type { GenerationOutput } from '@/domain/generation'
import type { RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import type { ImageGenCapByRole } from '@/domain/image-gen-config'
import { RECIPE_GEN_WINDOW_MS } from '@/domain/recipe-gen-quota'
import { reserveQuotaHold } from '@/server/quota/atomic'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedRecipeIngredient, seedTranslation } from '../helpers/recipes'
import { cannedSuccess, cannedParseFailed, cannedRefusal, makeBriefing, makeReceita, post } from '../helpers/generation'
import { makeTranscript, cannedTokens, postStream, collectNdjson } from '../helpers/conversation'

/**
 * RESERVA de cota ANTES da chamada paga (#640/#641, ADR-0055) contra o Postgres real, pela porta mais alta.
 *
 * O gate atômico do #446 só rodava no persist, DEPOIS do provedor: M pedidos paralelos com a cota em N-1
 * passavam todos no pré-check e TODOS pagavam. Aqui cada caminho pago (geração single e "gerar 2",
 * regeneração, imagem, conversa) prova, com o CONTADOR de chamadas do dublê, que só os pedidos que cabem chegam
 * ao provedor; e a regra de cobrança: falha provadamente não paga do provedor DEVOLVE o slot, saída inválida e
 * abort o CONSOMEM (sem linha de `generation`), admin (∞) não cria reserva, reserva vencida não conta.
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function setRecipeGenCap(caps: RecipeGenCapByRole, variants = false): Promise<void> {
  const recipeVariantConfig = { ...DEFAULT_RECIPE_VARIANT_CONFIG, enabled: variants }
  await getDb()
    .insert(appConfig)
    .values({ id: true, recipeGenCapByRole: caps, recipeVariantConfig })
    .onConflictDoUpdate({ target: appConfig.id, set: { recipeGenCapByRole: caps, recipeVariantConfig } })
}

async function setImageGenCap(caps: ImageGenCapByRole): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({ id: true, imageGenEnabled: true, imageGenCapByRole: caps })
    .onConflictDoUpdate({ target: appConfig.id, set: { imageGenEnabled: true, imageGenCapByRole: caps } })
}

async function count(table: 'generation' | 'quota_hold' | 'image_generation'): Promise<number> {
  const [r] = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`)
  return r.n
}

async function holds(): Promise<{ kind: string; slots: number; createdAt: Date; expiresAt: Date }[]> {
  return getDb()
    .select({ kind: quotaHold.kind, slots: quotaHold.slots, createdAt: quotaHold.createdAt, expiresAt: quotaHold.expiresAt })
    .from(quotaHold)
}

/** Semeia `n` gerações já persistidas do usuário (contam no teto de receita). */
async function seedGenerations(userId: string, n: number): Promise<void> {
  const [s] = await getDb()
    .insert(creationSession)
    .values({ userId, mode: 'free_text', recipeId: null, freeText: 'pedido qualquer' })
    .returning({ id: creationSession.id })
  await getDb()
    .insert(generation)
    .values(
      Array.from({ length: n }, () => ({
        creationSessionId: s.id,
        recipeId: null,
        outcome: 'impossible' as const,
        model: 'claude-opus-5-5',
        schemaVersion: 1,
      })),
    )
}

function variantsOk(): GenerationOutput[] {
  const v = (variacao: string): GenerationOutput => ({ kind: 'object', modelKind: 'success', recipe: makeReceita(), advisory: null, variacao })
  return [v('tradicional'), v('com um toque criativo')]
}

const structured = () => ({ mode: 'structured', briefing: makeBriefing() })

describe('POST /api/generations — reserva antes do Claude (#641)', () => {
  it('cota em N-1, 5 pedidos simultâneos ⇒ UMA chamada ao Claude; 1×201 e 4×429 (contrato de sempre)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-single@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null })
    await seedGenerations(userId, 1)
    const claude = new FakeClaudeClient(undefined, cannedSuccess())
    setClaudeClient(claude)

    const results = await Promise.all(Array.from({ length: 5 }, () => post(structured(), headers)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 429, 429, 429, 429])
    expect(claude.generateCalls).toBe(1) // os 4 de cima pararam na reserva, ANTES do provedor
    expect(await count('generation')).toBe(2)
    expect(await count('quota_hold')).toBe(0) // a reserva do que passou foi consumida no persist
    const body = (await results.find((r) => r.status === 429)!.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
  })

  it('"gerar 2": 3 slots livres, 4 pedidos simultâneos ⇒ UMA chamada do lote; 3×429 limite_geracao_variacao', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-variar2@q.test' })
    await setRecipeGenCap({ usuario: 5, curador: 20, admin: null }, true)
    await seedGenerations(userId, 2)
    const claude = new FakeClaudeClient(undefined, undefined, undefined, undefined, variantsOk())
    setClaudeClient(claude)

    const results = await Promise.all(
      Array.from({ length: 4 }, () => post({ ...structured(), variar2: true }, headers)),
    )
    expect(results.map((r) => r.status).sort()).toEqual([201, 429, 429, 429])
    expect(claude.variantsCalls).toBe(1) // um par cabe (2 slots); o 2º par não cabe no slot que sobra
    expect(await count('generation')).toBe(4)
    expect(await count('quota_hold')).toBe(0)
    const body = (await results.find((r) => r.status === 429)!.json()) as { error: string }
    expect(body.error).toBe('limite_geracao_variacao')
  })

  it('falha do provedor SEM cobrança (parse_failed cause:provider) ⇒ 502 e o slot VOLTA', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-provider@q.test' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })
    setClaudeClient(new FakeClaudeClient(undefined, { kind: 'parse_failed', cause: 'provider' }))

    const res = await post(structured(), headers)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toEqual({ outcome: 'invalid', error: 'geracao_invalida' })
    expect(await count('quota_hold')).toBe(0)

    // O único slot do teto continua livre: a próxima geração passa.
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    expect((await post(structured(), headers)).status).toBe(201)
  })

  it('"gerar 2": lote que falhou no provedor sem cobrança devolve os 2 slots', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-variar2-provider@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null }, true)
    setClaudeClient(new FakeClaudeClient(undefined, undefined, undefined, undefined, [{ kind: 'parse_failed', cause: 'provider' }]))

    expect((await post({ ...structured(), variar2: true }, headers)).status).toBe(502)
    expect(await count('quota_hold')).toBe(0)
  })

  it('saída INVÁLIDA (parse_failed sem cause / refusal) ⇒ 502, sem generation, e o slot fica COBRADO por 24h', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-invalid@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null })
    setClaudeClient(new FakeClaudeClient(undefined, cannedParseFailed()))
    expect((await post(structured(), headers)).status).toBe(502)
    setClaudeClient(new FakeClaudeClient(undefined, cannedRefusal()))
    expect((await post(structured(), headers)).status).toBe(502)

    expect(await count('generation')).toBe(0) // ADR-0006: inválido nunca vira generation
    const rows = await holds()
    expect(rows).toHaveLength(2)
    for (const h of rows) {
      expect(h.kind).toBe('recipe_gen')
      expect(h.expiresAt.getTime() - h.createdAt.getTime()).toBe(RECIPE_GEN_WINDOW_MS)
    }

    // Teto (2) gasto pelas duas inválidas: o 3º pedido leva 429 sem tocar o Claude.
    const claude = new FakeClaudeClient(undefined, cannedSuccess())
    setClaudeClient(claude)
    const res = await post(structured(), headers)
    expect(res.status).toBe(429)
    expect(claude.generateCalls).toBe(0)
  })

  it('admin (∞) não cria reserva: nem a inválida deixa linha em quota_hold', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-admin@q.test', role: 'admin' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedParseFailed()))
    expect((await post(structured(), headers)).status).toBe(502)
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    expect((await post(structured(), headers)).status).toBe(201)
    expect(await count('quota_hold')).toBe(0)
  })

  it('reserva VENCIDA não conta; reserva ativa de outro pedido conta (429 sem tocar o Claude)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-expired@q.test' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })
    const now = Date.now()
    await getDb().insert(quotaHold).values({
      userId,
      kind: 'recipe_gen',
      slots: 2,
      createdAt: new Date(now - RECIPE_GEN_WINDOW_MS - 1000),
      expiresAt: new Date(now - 1000),
    })
    // Reserva ATIVA de imagem não conta na cota de receita (tipos separados).
    await getDb().insert(quotaHold).values({ userId, kind: 'image_gen', expiresAt: new Date(now + RECIPE_GEN_WINDOW_MS) })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    expect((await post(structured(), headers)).status).toBe(201)

    // Outra conta, cota 1 e uma reserva ATIVA de receita de um pedido em voo: o pré-check (só eventos) passa,
    // a reserva barra, com o countdown da reserva (~24 h).
    const { userId: u2, headers: h2 } = await seedSessionHeaders({ email: 'hold-active@q.test' })
    await getDb().insert(quotaHold).values({ userId: u2, kind: 'recipe_gen', expiresAt: new Date(now + RECIPE_GEN_WINDOW_MS) })
    const claude = new FakeClaudeClient(undefined, cannedSuccess())
    setClaudeClient(claude)
    const res = await post(structured(), h2)
    expect(res.status).toBe(429)
    expect(((await res.json()) as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(RECIPE_GEN_WINDOW_MS - 60_000)
    expect(claude.generateCalls).toBe(0)
  })

  it('reserveQuotaHold: cap ∞ ⇒ null, sem linha; "gerar 2" grava slots=2', async () => {
    const { userId } = await seedSessionHeaders({ email: 'hold-unit@q.test' })
    expect(await reserveQuotaHold(getDb(), { userId, kind: 'recipe_gen', cap: Infinity })).toBeNull()
    expect(await count('quota_hold')).toBe(0)
    const id = await reserveQuotaHold(getDb(), { userId, kind: 'recipe_gen', cap: 3, slots: 2 })
    expect(id).toEqual(expect.any(String))
    const [row] = await getDb().select().from(quotaHold).where(eq(quotaHold.id, id!))
    expect(row.slots).toBe(2)
    // Com 2 dos 3 slots reservados, outro "gerar 2" não cabe; um single cabe.
    await expect(reserveQuotaHold(getDb(), { userId, kind: 'recipe_gen', cap: 3, slots: 2 })).rejects.toMatchObject({
      name: 'QuotaExceededError',
    })
    expect(await reserveQuotaHold(getDb(), { userId, kind: 'recipe_gen', cap: 3 })).toEqual(expect.any(String))
  })
})

/** Receita free_text PRÓPRIA com a sessão que a entregou + a generation dela (conta 1 no teto). */
async function seedOwnFreeTextRecipe(ownerId: string): Promise<string> {
  const recipeId = await seedRecipe({
    origin: 'ai_free_text',
    originalLocale: 'pt-BR',
    visibility: 'private',
    resultKind: 'success',
    ownerId,
    cozinha: 'brasileira',
    porcoes: 4,
    dificuldade: 2,
  })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Original', provenance: 'automatica_nao_revisada' })
  const [s] = await getDb()
    .insert(creationSession)
    .values({ userId: ownerId, mode: 'free_text', recipeId, freeText: 'um arroz de forno cremoso com queijo' })
    .returning({ id: creationSession.id })
  await getDb()
    .insert(generation)
    .values({ creationSessionId: s.id, recipeId, outcome: 'success', model: 'claude-opus-5-5', schemaVersion: 1 })
  return recipeId
}

const regenerate = (id: string, headers: Headers) =>
  regenerateRoute(new Request(`http://localhost/api/recipes/${id}/regenerate`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })

describe('POST /api/recipes/[id]/regenerate — reserva antes do Claude (#641)', () => {
  it('cota em N-1, 4 regenerações simultâneas ⇒ UMA chamada ao Claude; 1×201 e 3×429', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-regen@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null })
    const recipeId = await seedOwnFreeTextRecipe(userId)
    const claude = new FakeClaudeClient(undefined, cannedSuccess())
    setClaudeClient(claude)
    setEmbedder(new FakeEmbedder())

    const results = await Promise.all(Array.from({ length: 4 }, () => regenerate(recipeId, headers)))
    expect(results.map((r) => r.status).sort()).toEqual([201, 429, 429, 429])
    expect(claude.generateCalls).toBe(1)
    expect(await count('generation')).toBe(2)
    expect(await count('quota_hold')).toBe(0)
  })

  it('falha do provedor sem cobrança devolve o slot; saída inválida o consome', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-regen-fail@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null })
    const recipeId = await seedOwnFreeTextRecipe(userId) // 1 dos 2 slots

    setClaudeClient(new FakeClaudeClient(undefined, { kind: 'parse_failed', cause: 'provider' }))
    expect((await regenerate(recipeId, headers)).status).toBe(502)
    expect(await count('quota_hold')).toBe(0)

    setClaudeClient(new FakeClaudeClient(undefined, cannedParseFailed()))
    expect((await regenerate(recipeId, headers)).status).toBe(502)
    expect(await count('quota_hold')).toBe(1)

    const claude = new FakeClaudeClient(undefined, cannedSuccess())
    setClaudeClient(claude)
    expect((await regenerate(recipeId, headers)).status).toBe(429)
    expect(claude.generateCalls).toBe(0)
  })
})

describe('POST /api/recipes/[id]/image/generate — reserva antes do Gemini (#640)', () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
  const genReq = (id: string, headers: Headers) =>
    new Request(`http://localhost/api/recipes/${id}/image/generate`, {
      method: 'POST',
      headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
    })

  async function seedOwned(ownerId: string): Promise<string> {
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo de fubá', provenance: 'automatica_nao_revisada' })
    await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'fubá', quantidade: null })
    return id
  }

  it('cota em N-1, 5 gerações simultâneas ⇒ UMA chamada ao Gemini; 1×200 e 4×429', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-img@q.test' })
    await setImageGenCap({ usuario: 2, curador: 5, admin: null })
    await getDb().insert(imageGeneration).values({ userId })
    const id = await seedOwned(userId)
    setImageStore(new FakeImageStore())
    const gen = new FakeImageGenerator()
    setImageGenerator(gen)

    const results = await Promise.all(Array.from({ length: 5 }, () => imageGenerate(genReq(id, headers), ctx(id))))
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429, 429, 429])
    expect(gen.calls).toBe(1)
    expect(await count('image_generation')).toBe(2)
    expect(await count('quota_hold')).toBe(0)
    const body = (await results.find((r) => r.status === 429)!.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
  })

  it('Gemini fora do ar (sem cobrança) ⇒ 503 e o slot VOLTA; falha depois de resposta paga ⇒ slot COBRADO', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-img-fail@q.test' })
    await setImageGenCap({ usuario: 1, curador: 5, admin: null })
    const id = await seedOwned(userId)
    setImageStore(new FakeImageStore())

    setImageGenerator(new ThrowingImageGenerator('unavailable'))
    expect((await imageGenerate(genReq(id, headers), ctx(id))).status).toBe(503)
    expect(await count('quota_hold')).toBe(0)

    setImageGenerator(new ThrowingImageGenerator('paid'))
    expect((await imageGenerate(genReq(id, headers), ctx(id))).status).toBe(503)
    const rows = await holds()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('image_gen')
    expect(await count('image_generation')).toBe(0)

    const gen = new FakeImageGenerator()
    setImageGenerator(gen)
    expect((await imageGenerate(genReq(id, headers), ctx(id))).status).toBe(429)
    expect(gen.calls).toBe(0)
  })

  it('admin (∞) não cria reserva de imagem', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-img-admin@q.test', role: 'admin' })
    await setImageGenCap({ usuario: 1, curador: 5, admin: null })
    const id = await seedOwned(userId)
    setImageStore(new FakeImageStore())
    setImageGenerator(new ThrowingImageGenerator('paid'))
    expect((await imageGenerate(genReq(id, headers), ctx(id))).status).toBe(503)
    expect(await count('quota_hold')).toBe(0)
  })
})

describe('POST /api/conversations/stream — reserva antes de abrir o stream (#640/#641)', () => {
  it('cota em N-1, 4 turnos simultâneos ⇒ UM stream pago; 1×200 e 3×429 JSON', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'hold-conv@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null })
    await seedGenerations(userId, 1)
    const claude = new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens())
    setClaudeClient(claude)
    setEmbedder(new FakeEmbedder())

    const results = await Promise.all(Array.from({ length: 4 }, () => postStream({ transcript: makeTranscript() }, headers)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429, 429])
    const frames = await collectNdjson(results.find((r) => r.status === 200)!)
    expect(frames.at(-1)).toMatchObject({ type: 'recipe' })
    expect(claude.streamCalls).toBe(1)
    expect(claude.generateCalls).toBe(1)
    expect(await count('generation')).toBe(2)
    expect(await count('quota_hold')).toBe(0)
    const body = (await results.find((r) => r.status === 429)!.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
  })

  it('o provedor recusa o stream ANTES de qualquer evento (sem cobrança) ⇒ o slot VOLTA', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-conv-provider@q.test' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })
    const failing = new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens())
    failing.streamError = new ClaudeProviderUnavailableError()
    setClaudeClient(failing)

    const res = await postStream({ transcript: makeTranscript() }, headers)
    expect(res.status).toBe(200)
    await res.text().catch(() => undefined) // `controller.error` derruba o corpo
    expect(await count('quota_hold')).toBe(0)

    const claude = new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens())
    setClaudeClient(claude)
    setEmbedder(new FakeEmbedder())
    const ok = await postStream({ transcript: makeTranscript() }, headers)
    expect(ok.status).toBe(200)
    expect((await collectNdjson(ok)).at(-1)).toMatchObject({ type: 'recipe' })
  })

  it('erro qualquer do stream (pago) ou destilação inválida ⇒ o slot fica COBRADO', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-conv-paid@q.test' })
    await setRecipeGenCap({ usuario: 2, curador: 20, admin: null })

    const failing = new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens())
    failing.streamError = new Error('erro SSE no meio do stream')
    setClaudeClient(failing)
    const r1 = await postStream({ transcript: makeTranscript() }, headers)
    await r1.text().catch(() => undefined)

    // Destilação com falha do provedor (cause:'provider'): o stream já foi pago ⇒ cobrado mesmo assim.
    setClaudeClient(new FakeClaudeClient(undefined, { kind: 'parse_failed', cause: 'provider' }, cannedTokens()))
    const r2 = await postStream({ transcript: makeTranscript() }, headers)
    expect((await collectNdjson(r2)).at(-1)).toEqual({ type: 'error', error: 'geracao_invalida' })

    expect(await count('generation')).toBe(0)
    expect(await count('quota_hold')).toBe(2)
    const claude = new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens())
    setClaudeClient(claude)
    expect((await postStream({ transcript: makeTranscript() }, headers)).status).toBe(429)
    expect(claude.streamCalls).toBe(0)
  })

  it('ABORT depois do 1º token ⇒ nada persiste, mas o slot fica COBRADO (#640)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'hold-conv-abort@q.test' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })

    const controller = new AbortController()
    let resolveFinished!: () => void
    const streamFinished = new Promise<void>((r) => {
      resolveFinished = r
    })
    const probe = new FakeClaudeClient(undefined, cannedSuccess())
    probe.streamConversation = async function* (input?: ConversationStreamInput) {
      try {
        yield 't1 '
        await new Promise<void>((resolve) => {
          if (input?.signal?.aborted) return resolve()
          input?.signal?.addEventListener('abort', () => resolve(), { once: true })
        })
      } finally {
        resolveFinished()
      }
    }
    setClaudeClient(probe)

    const res = await streamRoute(
      new Request('http://localhost/api/conversations/stream', {
        method: 'POST',
        headers,
        body: JSON.stringify({ transcript: makeTranscript() }),
        signal: controller.signal,
      }),
    )
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    await reader.read() // 1º token
    controller.abort()
    await streamFinished
    await reader.cancel()

    expect(probe.generateCalls).toBe(0) // destilação pulada
    expect(await count('generation')).toBe(0)
    const rows = await holds()
    expect(rows).toHaveLength(1)
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(RECIPE_GEN_WINDOW_MS)

    const claude = new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens())
    setClaudeClient(claude)
    expect((await postStream({ transcript: makeTranscript() }, headers)).status).toBe(429)
    expect(claude.streamCalls).toBe(0)
  })
})
