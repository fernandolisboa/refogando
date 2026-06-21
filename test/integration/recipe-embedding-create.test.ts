import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { POST } from '@/app/api/generations/route'
import { getDb, setClaudeClient, setEmbedder } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import { FakeEmbedder, ThrowingEmbedder } from '@/server/embedding/embedder'
import { EMBEDDING_MODEL } from '@/server/embedding/recompute'
import { recipeEmbedding } from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess, makeBriefing } from '../helpers/generation'

/**
 * Embedding NA CRIAÇÃO (#119) — receitas criadas pelo usuário ganham vetor semântico (antes: 0 linhas
 * `recipe_embedding`, lane semântica morta). Best-effort (ASSISTIVO): a criação persiste mesmo se o
 * embedder LANÇA (sem key / 429). Pela porta mais alta (POST /api/generations) com Claude e Embedder
 * fakes. O caminho REAL do Gemini (RealEmbedder) NÃO é exercitado — só roda ao vivo com a key (gate
 * humano), como o gerador de imagem (#132).
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/generations', { method: 'POST', headers, body: JSON.stringify(body) }),
  )
}

async function embeddingOf(recipeId: string, locale: string) {
  const [emb] = await getDb()
    .select({
      model: recipeEmbedding.model,
      stale: recipeEmbedding.stale,
      dims: dsql`array_length(${recipeEmbedding.embedding}::real[], 1)`.mapWith(Number),
    })
    .from(recipeEmbedding)
    .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, locale)))
  return emb
}

describe('Embedding na criação de receita (#119)', () => {
  it('criar (structured) com Embedder real-fake ⇒ recipe_embedding 1536-dim, model, stale=false', async () => {
    const { headers } = await seedSessionHeaders({ email: 'emb-create@ex.com' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS)) // 1536 dims — casa vector(1536)

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    const { recipeId } = (await res.json()) as { recipeId: string }

    const emb = await embeddingOf(recipeId, 'pt-BR') // originalLocale da geração
    expect(emb).toBeDefined()
    expect(emb.dims).toBe(EMBEDDING_DIMENSIONS)
    expect(emb.model).toBe(EMBEDDING_MODEL)
    expect(emb.stale).toBe(false)
  })

  it('embedder INDISPONÍVEL (Throwing): a criação persiste 201; só NÃO ganha embedding (degrada)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'emb-throw@ex.com' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new ThrowingEmbedder()) // sem key / 429 / rede — o embed é best-effort (swallow)

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201) // a Receita NÃO falha por causa do embedder
    const { recipeId } = (await res.json()) as { recipeId: string }

    expect(await embeddingOf(recipeId, 'pt-BR')).toBeUndefined() // sem vetor — Busca degrada p/ FTS
  })
})
