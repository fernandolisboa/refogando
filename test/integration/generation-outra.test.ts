import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import { recipe, briefing, vocabularyTerm } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess, makeBriefing, post } from '../helpers/generation'

/**
 * Fluxo "Outra" na GERAÇÃO (#319, ADR-0025 Decisão 5) pela porta mais alta — POST /api/generations
 * contra o Postgres real. O `FakeClaudeClient` devolve uma Receita com `cozinha=NULL` (espelha a
 * realidade: a IA NÃO pode emitir cozinha fora do `z.enum` dos ativos), provando que o SERVIDOR
 * estampa o slug `suggested` por cima do null — um canned com cozinha ativa mascararia o override.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

async function termRows(slug: string) {
  return getDb()
    .select()
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
}

describe('POST /api/generations — "Outra" → termo suggested (#319)', () => {
  it('cozinhaOutra="Georgiana" (IA emite cozinha=null) → cria suggested + briefing.cozinha + recipe.cozinha = georgiana, receita persistida', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'outra-gen@gen.test' })
    // A IA NÃO inventa cozinha: devolve null (georgiana não está no z.enum ativo).
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({ cozinha: null })))

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: 'Georgiana' },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { recipeId: string | null }
    expect(json.recipeId).toBeTruthy()

    // Termo suggested materializado (labels NULL — Curador completa em #320).
    const terms = await termRows('georgiana')
    expect(terms).toHaveLength(1)
    expect(terms[0].status).toBe('suggested')
    expect(terms[0].labelPtBr).toBeNull()
    expect(terms[0].labelEnUs).toBeNull()

    // briefing.cozinha = o slug suggested (proveniência do PEDIDO).
    const [bf] = await getDb().select({ cozinha: briefing.cozinha }).from(briefing)
    expect(bf.cozinha).toBe('georgiana')

    // recipe.cozinha = o slug suggested (estampado pelo servidor por cima do null da IA).
    const [rec] = await getDb()
      .select({ cozinha: recipe.cozinha, ownerId: recipe.ownerId, visibility: recipe.visibility })
      .from(recipe)
      .where(eq(recipe.id, json.recipeId!))
    expect(rec.cozinha).toBe('georgiana')
    expect(rec.ownerId).toBe(userId)
    expect(rec.visibility).toBe('private') // persistida normalmente (não bloqueada)
  })

  it('2ª sessão com a MESMA cozinhaOutra anexa — sem linha duplicada, segue 1 suggested', async () => {
    const { headers: h1 } = await seedSessionHeaders({ email: 'outra-1@gen.test' })
    const { headers: h2 } = await seedSessionHeaders({ email: 'outra-2@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({ cozinha: null })))

    const r1 = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: 'Georgiana' },
      h1,
    )
    expect(r1.status).toBe(201)
    const r2 = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: 'georgiana' },
      h2,
    )
    expect(r2.status).toBe(201)

    const terms = await termRows('georgiana')
    expect(terms).toHaveLength(1)
    expect(terms[0].status).toBe('suggested')
  })
})
