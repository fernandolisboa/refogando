import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import type { ClaudeClient } from '@/server/claude/client'
import { FakeClaudeClient } from '@/server/claude/client'
import { recipe, briefing, vocabularyTerm, appConfig } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess, cannedRefusal, makeBriefing, post } from '../helpers/generation'

/** Cliente que ESTOURA se o seam for tocado — prova que um portão barrou ANTES da geração. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('echo não devia ser chamado')
  }
  async generateRecipeVariants(): Promise<never> {
    throw new Error('generateRecipeVariants não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: o portão devia ter barrado ANTES da geração')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('streamConversation não devia ser chamado')
  }
  async extractIngredients(): Promise<never> {
    throw new Error('extractIngredients não devia ser chamado')
  }
}

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

  it('briefing SÓ-Outra (cozinha null + zero itens) NÃO vira briefing_vazio → 201 + termo', async () => {
    // FIX (diff-review A): o slug "Outra" é injetado ANTES do parseBriefing, então um briefing sem
    // itens conta como NÃO-vazio (a cozinha preenche o campo-mínimo). Antes do fix isto dava 400.
    const { headers } = await seedSessionHeaders({ email: 'outra-so@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({ cozinha: null })))

    const res = await post(
      {
        mode: 'structured',
        briefing: { cozinha: null, restricoes: [], porcoes: null, dificuldade: null, observacoes: null, itens: [] },
        cozinhaOutra: 'Georgiana',
      },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { recipeId: string | null }
    expect(json.recipeId).toBeTruthy()
    const [rec] = await getDb()
      .select({ cozinha: recipe.cozinha })
      .from(recipe)
      .where(eq(recipe.id, json.recipeId!))
    expect(rec.cozinha).toBe('georgiana')
    expect(await termRows('georgiana')).toHaveLength(1)
  })

  it('cozinhaOutra só-símbolo (slug vazio) ⇒ 400 cozinha_invalida, NENHUM termo', async () => {
    const { headers } = await seedSessionHeaders({ email: 'outra-simbolo@gen.test' })
    setClaudeClient(new ExplodingClaudeClient()) // não deve tocar o seam
    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: '!!!' },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'cozinha_invalida' })
  })

  it('cozinhaOutra longo demais (> 80 chars) ⇒ 400, sem tocar o seam nem materializar termo', async () => {
    const { headers } = await seedSessionHeaders({ email: 'outra-longo@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())
    const longo = 'cozinha muito comprida '.repeat(10) // > 80 chars
    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: longo },
      headers,
    )
    expect(res.status).toBe(400)
  })

  it('over-quota (429) NÃO materializa o termo — fecha o bypass do teto via Curador (#320)', async () => {
    // DEFER FIX: o INSERT do termo é DEFERIDO p/ depois do teto. Um usuário no teto que reposta com
    // cozinhaOutra distintos NÃO pode inundar a fila do Curador (nem tocar o seam).
    const { headers } = await seedSessionHeaders({ email: 'outra-quota@gen.test' })
    // cap=0 p/ o papel padrão ⇒ a 1ª geração já estoura (429), seam barrado.
    const caps = { usuario: 0, curador: 20, admin: null }
    await getDb()
      .insert(appConfig)
      .values({ id: true, recipeGenCapByRole: caps })
      .onConflictDoUpdate({ target: appConfig.id, set: { recipeGenCapByRole: caps } })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: 'Mongol' },
      headers,
    )
    expect(res.status).toBe(429)
    expect(await termRows('mongol')).toHaveLength(0) // termo NÃO foi gravado
  })

  it('geração invalid (502) NÃO deixa termo órfão', async () => {
    const { headers } = await seedSessionHeaders({ email: 'outra-invalid@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedRefusal())) // → 502
    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), cozinhaOutra: 'Sumeria' },
      headers,
    )
    expect(res.status).toBe(502)
    expect(await termRows('sumeria')).toHaveLength(0) // sem órfão
  })
})
