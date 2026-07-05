import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/admin/ai-cost/route'
import { getDb } from '@/server/deps'
import { creationSession, generation, imageGeneration, recipeReview } from '@/db/schema'
import { SCHEMA_VERSION_RECEITA } from '@/domain/recipe'
import type { AiCostSummary } from '@/domain/ai-cost-read'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe, seedSave } from '../helpers/recipes'

/**
 * Painel de custo de IA pela porta real (GET /api/admin/ai-cost) — #465. ADMIN-ONLY (anon → 401;
 * Usuário → 403; Admin → 200). Agrega os ledgers de texto (#463) e imagem (#224): totais, top usuários e
 * custo do texto por desfecho (salvo/avaliado). Só linhas com `cost_usd` não-nulo entram nas somas.
 */

function call(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/admin/ai-cost', { headers }))
}

/** Insere uma geração de TEXTO com custo, ligada a uma creation_session do `userId`. `recipeId` opcional. */
async function seedTextCost(input: {
  userId: string
  costUsd: string | null
  recipeId?: string | null
}): Promise<void> {
  const db = getDb()
  const [cs] = await db
    .insert(creationSession)
    .values({ userId: input.userId, mode: 'free_text' })
    .returning({ id: creationSession.id })
  await db.insert(generation).values({
    creationSessionId: cs.id,
    recipeId: input.recipeId ?? null,
    outcome: input.recipeId ? 'success' : 'impossible',
    model: 'claude-opus-4-8',
    schemaVersion: SCHEMA_VERSION_RECEITA,
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: input.costUsd,
  })
}

/** Insere uma geração de IMAGEM com custo para `userId`. */
async function seedImageCost(userId: string, costUsd: string): Promise<void> {
  await getDb().insert(imageGeneration).values({
    userId,
    model: 'gemini-3.1-flash-image',
    promptTokens: 100,
    outputTokens: 1290,
    thinkingTokens: 0,
    totalTokens: 1390,
    costUsd,
  })
}

describe('GET /api/admin/ai-cost — gate de papel', () => {
  it('anônimo (sem sessão) → 401', async () => {
    expect((await call()).status).toBe(401)
  })

  it('usuário comum → 403 (gate de verdade, não link escondido)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'u@cost.test', role: 'usuario' })
    expect((await call(headers)).status).toBe(403)
  })

  it('admin → 200', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm@cost.test', role: 'admin' })
    expect((await call(headers)).status).toBe(200)
  })
})

describe('GET /api/admin/ai-cost — agregação dos dois ledgers', () => {
  it('soma texto + imagem; top usuário; desfecho salvo/avaliado; ignora cost_usd NULL', async () => {
    const { headers } = await seedSessionHeaders({ email: 'adm-agg@cost.test', role: 'admin' })
    const spender = await seedUser({ email: 'spender@cost.test', handle: 'spender' })

    // Receita SALVA e AVALIADA (desfecho engajado) — geração de texto custou $0.030000.
    const salva = await seedRecipe({ origin: 'ai_free_text', originalLocale: 'pt-BR', ownerId: spender })
    await seedTextCost({ userId: spender, costUsd: '0.030000', recipeId: salva })
    await seedSave({ userId: spender, recipeId: salva })
    await getDb()
      .insert(recipeReview)
      .values({ userId: spender, recipeId: salva, rating: 5 })

    // Receita gerada mas NÃO salva/avaliada — texto custou $0.010000.
    const solta = await seedRecipe({ origin: 'ai_free_text', originalLocale: 'pt-BR', ownerId: spender })
    await seedTextCost({ userId: spender, costUsd: '0.010000', recipeId: solta })

    // Imagem do mesmo usuário — custou $0.077000.
    await seedImageCost(spender, '0.077000')

    // Linha SEM telemetria (cost_usd NULL) — NÃO deve entrar em nenhuma soma.
    await seedTextCost({ userId: spender, costUsd: null, recipeId: null })

    const res = await call(headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as AiCostSummary

    // Top usuário: EXATO e scoped ao meu spender (robusto sob DB compartilhado) — prova a soma dos DOIS
    // ledgers por usuário (texto via creation_session + imagem direta). A linha NULL-cost soma nada.
    const row = body.topUsers.find((u) => u.userId === spender)
    expect(row).toBeDefined()
    expect(row!.textUsd).toBeCloseTo(0.04, 6)
    expect(row!.imageUsd).toBeCloseTo(0.077, 6)
    expect(row!.totalUsd).toBeCloseTo(0.117, 6)

    // Totais GLOBAIS: `>=` a minha contribuição (outros testes deixam cost_usd NULL, mas nunca menos).
    expect(body.totals.textUsd).toBeGreaterThanOrEqual(0.04 - 1e-9)
    expect(body.totals.imageUsd).toBeGreaterThanOrEqual(0.077 - 1e-9)
    expect(body.totals.totalUsd).toBeGreaterThanOrEqual(0.117 - 1e-9)

    // Desfecho GLOBAL: `>=` (salvo e avaliado se sobrepõem — a MESMA Receita salva=avaliada=0.03). A minha
    // Receita solta (0.01) entra em total mas não em saved/starred; a linha NULL-cost/sem-Receita não entra.
    expect(body.byOutcome.totalCount).toBeGreaterThanOrEqual(2)
    expect(body.byOutcome.totalUsd).toBeGreaterThanOrEqual(0.04 - 1e-9)
    expect(body.byOutcome.savedCount).toBeGreaterThanOrEqual(1)
    expect(body.byOutcome.savedUsd).toBeGreaterThanOrEqual(0.03 - 1e-9)
    expect(body.byOutcome.starredCount).toBeGreaterThanOrEqual(1)
    expect(body.byOutcome.starredUsd).toBeGreaterThanOrEqual(0.03 - 1e-9)
  })
})
