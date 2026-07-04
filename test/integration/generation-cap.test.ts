import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import type { ClaudeClient } from '@/server/claude/client'
import { FakeClaudeClient } from '@/server/claude/client'
import { appConfig, creationSession, generation } from '@/db/schema'
import type { RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess, makeBriefing, post } from '../helpers/generation'

/**
 * Teto diário de geração de RECEITA por papel (#167) pela porta mais alta — POST /api/generations
 * contra o Postgres real, com o seam do Claude trocado. Prova: estourado ⇒ 429 limite_geracao (o
 * seam NÃO é tocado); abaixo do teto ⇒ segue normal; admin (∞) ignora o teto; cap da CONFIG do admin
 * substitui o default (aperta E afrouxa). Espelha recipe-image-generate.test.ts (teto de imagem).
 *
 * `setup.ts` faz resetDeps() + truncateAll antes de cada teste, então app_config nasce vazia (defaults
 * em código) salvo seed explícito.
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Cliente que ESTOURA se o seam for tocado — prova que o teto barrou ANTES da geração. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('echo não devia ser chamado')
  }
  async generateRecipeVariants(): Promise<never> {
    throw new Error('generateRecipeVariants não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: o teto devia ter barrado ANTES da geração')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('streamConversation não devia ser chamado')
  }
  async extractIngredients(): Promise<never> {
    throw new Error('extractIngredients não devia ser chamado')
  }
}

/**
 * Semeia N gerações JÁ persistidas do usuário (a fonte do teto): uma creation_session + N generation
 * penduradas nela. NÃO usa ledger novo — conta os registros de geração reais (generation⋈session).
 */
async function seedGenerationsForUser(userId: string, n: number): Promise<void> {
  if (n <= 0) return
  const [s] = await getDb()
    .insert(creationSession)
    .values({ userId, mode: 'free_text', recipeId: null, freeText: 'pedido qualquer' })
    .returning({ id: creationSession.id })
  await getDb().insert(generation).values(
    Array.from({ length: n }, () => ({
      creationSessionId: s.id,
      recipeId: null,
      outcome: 'impossible' as const,
      advisoryComment: null,
      model: 'claude-opus-4-8',
      schemaVersion: 1,
    })),
  )
}

/** #167: grava o teto de geração de receita no singleton app_config. */
async function setRecipeGenCap(caps: RecipeGenCapByRole): Promise<void> {
  await getDb()
    .insert(appConfig)
    .values({ id: true, recipeGenCapByRole: caps })
    .onConflictDoUpdate({ target: appConfig.id, set: { recipeGenCapByRole: caps } })
}

async function countGenerations(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  return r.n
}

describe('POST /api/generations — teto de geração por papel (#167)', () => {
  it('abaixo do teto (usuario default 10, com 9 gerações) → 201; segue normal', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'below@cap.test' })
    await seedGenerationsForUser(userId, 9)
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'success' })
  })

  it('no teto (usuario default 10, com 10 gerações) → 429 limite_geracao; seam NÃO tocado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'at@cap.test' })
    await seedGenerationsForUser(userId, 10)
    setClaudeClient(new ExplodingClaudeClient()) // estoura se a geração for tocada
    const before = await countGenerations()

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
    // Nenhuma geração nova nasceu (o teto barrou ANTES de persistir).
    expect(await countGenerations()).toBe(before)
  })

  it('admin (∞) ignora o teto: gera mesmo com muitas gerações recentes', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'admin@cap.test', role: 'admin' })
    await seedGenerationsForUser(userId, 50)
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
  })

  it('teto vem da CONFIG: usuario cap=1 ⇒ 2ª geração estoura (429), não o default 10', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cfg-tight@cap.test' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })
    await seedGenerationsForUser(userId, 1) // já no teto da config (1)
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: 'limite_geracao' })
  })

  it('teto da config pode AFROUXAR: usuario cap=15 ⇒ 12ª geração ainda cabe (default 10 já barraria)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cfg-loose@cap.test' })
    await setRecipeGenCap({ usuario: 15, curador: 20, admin: null })
    await seedGenerationsForUser(userId, 11) // > default 10, < config 15
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
  })

  it('teto da config pode ZERAR um papel: usuario cap=0 ⇒ até a 1ª geração estoura', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cfg-zero@cap.test' })
    await setRecipeGenCap({ usuario: 0, curador: 20, admin: null })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: 'limite_geracao' })
  })
})
