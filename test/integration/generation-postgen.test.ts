import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import type { ClaudeClient } from '@/server/claude/client'
import { FakeClaudeClient } from '@/server/claude/client'
import { recipe, briefing, creationSession } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedIngredient } from '../helpers/recipes'
import { cannedSuccess, countsBriefing, makeBriefing, post } from '../helpers/generation'

/**
 * Aviso PÓS-geração (#87) + modo PROMPT ABERTO `free_text` (#88) pela porta mais alta —
 * POST /api/generations contra o Postgres real, com o seam do Claude trocado por
 * `FakeClaudeClient(undefined, canned)`. `setup.ts` faz `resetDeps()` + `truncateAll`
 * antes de cada teste.
 *
 * #87: a RECEITA GERADA é re-checada (não só o input declarado). A UNIÃO é determinística
 * (pré-geração do Briefing PRIMEIRO, depois pós-geração da Receita; dedup por restrição).
 * Não-bloqueante: a Receita persiste mesmo com contradição.
 *
 * #88: texto livre vai CRU como prompt; validação 400 ANTES do seam; persiste o freeText
 * como proveniência (creation_session.free_text, sem briefing); origin = ai_free_text.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Cliente que ESTOURA se o seam for tocado — prova o corte ANTES da geração. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('ExplodingClaudeClient.echo não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: a validação devia ter cortado ANTES da geração')
  }
}

type AvisoView = { kind: string; restricao: string; alergeno: string; mensagem: string }
type GenResponse = {
  outcome: string
  recipeId: string | null
  advisory: string | null
  avisos?: AvisoView[]
}

describe('POST /api/generations — Aviso pós-geração (#87)', () => {
  // 87a + 87c — receita GERADA contradiz mesmo SEM o input declarar; não bloqueia.
  it('87a/87c: structured SEM FK que declare o alérgeno, mas receita gerada com "farinha de trigo" + restricoes:["sem_gluten"] → 201 + 1 aviso + Receita persiste', async () => {
    const { headers } = await seedSessionHeaders({ email: 'postgen-a@gen.test' })
    // Briefing sem alérgeno declarado (raw-text-only); a RECEITA gerada é que contradiz.
    setClaudeClient(
      new FakeClaudeClient(
        undefined,
        cannedSuccess({
          restricoes: ['sem_gluten'],
          ingredientes: [{ rawText: 'farinha de trigo', quantidade: '200.000', unidade: 'g' }],
        }),
      ),
    )

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ restricoes: [] }) },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse

    // O input NÃO declarou nada, mas a RECEITA gerada dispara o Aviso (endurecimento #87).
    expect(json.avisos).toBeDefined()
    expect(json.avisos).toHaveLength(1)
    expect(json.avisos![0].restricao).toBe('sem_gluten')
    expect(json.avisos![0].alergeno).toBe('trigo')

    // Não-bloqueante: a Receita persiste.
    expect(json.recipeId).toBeTruthy()
    const c = await countsBriefing(sql)
    expect(c.recipe).toBe(1)
  })

  // 87c — aplicado a TODOS os modos: conversation com receita contraditória dispara Aviso.
  it('87c: conversation com receita gerada contraditória → 201 + aviso (antes não tinha Aviso nenhum)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'postgen-conv@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(
        undefined,
        cannedSuccess({
          restricoes: ['sem_lactose'],
          ingredientes: [{ rawText: 'leite integral', quantidade: '500.000', unidade: 'ml' }],
        }),
      ),
    )

    const res = await post({ mode: 'conversation' }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse

    expect(json.avisos).toBeDefined()
    expect(json.avisos).toHaveLength(1)
    expect(json.avisos![0].restricao).toBe('sem_lactose')
    expect(json.avisos![0].alergeno).toBe('leite')
  })

  // 87b — união determinística: pré-geração (FK 'trigo') E pós-geração (rawText 'wheat
  // flour') contradizem sem_gluten → 1 aviso, alergeno do PRÉ-geração ('trigo') vence.
  it('87b: FK alergenos:["trigo"] + receita gerada com rawText "wheat flour" (ambos contradizem sem_gluten) → 1 aviso, alergeno==="trigo" (pré-geração primeiro)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'postgen-order@gen.test' })
    const ingId = await seedIngredient({ slug: 'farinha-trigo-ord', alergenos: ['trigo'] })
    setClaudeClient(
      new FakeClaudeClient(
        undefined,
        cannedSuccess({
          restricoes: ['sem_gluten'],
          ingredientes: [{ rawText: 'wheat flour', quantidade: '200.000', unidade: 'g' }],
        }),
      ),
    )

    const brief = makeBriefing({
      restricoes: ['sem_gluten'],
      itens: [
        {
          ingredientId: ingId,
          rawText: null,
          quantidade: '200.000',
          unidade: 'g',
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse

    // Dedup por restrição: 1 aviso para sem_gluten; o token do PEDIDO (pré-geração) vence.
    expect(json.avisos).toHaveLength(1)
    expect(json.avisos![0].restricao).toBe('sem_gluten')
    expect(json.avisos![0].alergeno).toBe('trigo')
  })

  // Regressão (FIX replace-vs-união): pré-geração preservado. FK 'trigo' contradiz
  // sem_gluten, receita gerada arroz/sal (default, sem contradição) → 1 aviso vindo do PRÉ.
  it('regressão: FK alergenos:["trigo"] + receita gerada arroz/sal (sem contradição) → 1 aviso do pré-geração', async () => {
    const { headers } = await seedSessionHeaders({ email: 'postgen-pre@gen.test' })
    const ingId = await seedIngredient({ slug: 'farinha-trigo-pre', alergenos: ['trigo'] })
    // makeReceita default → ingredientes arroz/sal, restricoes:['sem_gluten'] mas SEM trigo.
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const brief = makeBriefing({
      restricoes: ['sem_gluten'],
      itens: [
        {
          ingredientId: ingId,
          rawText: null,
          quantidade: '200.000',
          unidade: 'g',
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse

    expect(json.avisos).toHaveLength(1)
    expect(json.avisos![0].restricao).toBe('sem_gluten')
    expect(json.avisos![0].alergeno).toBe('trigo')
  })

  // Regressão: receita default (arroz/sal, restricoes:['sem_gluten'] mas sem ingrediente
  // contraditório) + briefing sem FK → SEM avisos (ausente ≠ vazio; pós-gen silente).
  it('regressão: briefing sem FK + receita gerada arroz/sal default → SEM avisos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'postgen-none@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ restricoes: ['sem_gluten'] }) },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse
    expect(json).not.toHaveProperty('avisos')
  })
})

describe('POST /api/generations — modo prompt aberto free_text (#88)', () => {
  // 88a + 88b — texto livre cru → 201 + Receita + origin ai_free_text (guarda de regressão
  // do fork do origin).
  it('88a/88b: {mode:"free_text", freeText} → 201 + recipeId + recipe.origin==="ai_free_text"', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ft-ok@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post(
      { mode: 'free_text', freeText: 'arroz com queijo gratinado no forno' },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse
    expect(json.outcome).toBe('success')
    expect(json.recipeId).toBeTruthy()

    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, json.recipeId!))
    expect(rec.origin).toBe('ai_free_text')
    expect(rec.visibility).toBe('private')
    expect(rec.ownerId).toBe(userId)
  })

  // 88c — texto vazio/só-espaços/curto → 400 free_text_vazio ANTES do seam (Exploding).
  it('88c: freeText "" / "   " / "curto" → 400 free_text_vazio; seam NUNCA tocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft-vazio@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    for (const freeText of ['', '   ', 'curto']) {
      const res = await post({ mode: 'free_text', freeText }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'free_text_vazio' })
    }
    // Nada persistido (o seam estouraria se tocado).
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 88c — freeText ausente / não-string → 400 free_text_vazio ANTES do seam.
  it('88c: freeText ausente / não-string → 400 free_text_vazio; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft-tipo@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const r1 = await post({ mode: 'free_text' }, headers)
    expect(r1.status).toBe(400)
    await expect(r1.json()).resolves.toMatchObject({ error: 'free_text_vazio' })

    const r2 = await post({ mode: 'free_text', freeText: 123 }, headers)
    expect(r2.status).toBe(400)
    await expect(r2.json()).resolves.toMatchObject({ error: 'free_text_vazio' })
  })

  // 88c — texto LONGO demais (> 2000 chars, simétrico ao observacoes structured) → 400
  // free_text_muito_longo ANTES do seam; nada persistido (custo/armazenamento blindados).
  it('88c: freeText > 2000 chars → 400 free_text_muito_longo; seam NUNCA tocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft-longo@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'free_text', freeText: 'a'.repeat(2001) }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'free_text_muito_longo' })

    // O teto conta APÓS o trim: espaços de sobra não burlam nem inflam o limite.
    const comEspacos = await post(
      { mode: 'free_text', freeText: `   ${'a'.repeat(2001)}   ` },
      headers,
    )
    expect(comEspacos.status).toBe(400)
    await expect(comEspacos.json()).resolves.toMatchObject({ error: 'free_text_muito_longo' })

    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 88d — anônimo (sem headers) → 401, idêntico ao structured anônimo; seam intocado.
  it('88d: free_text anônimo (sem headers) → 401; nada criado', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'free_text', freeText: 'arroz com queijo gratinado' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 88e — persiste o freeText CRU (trimado) como proveniência; briefing_id NULL; sem briefing.
  it('88e: persiste creation_session.mode="free_text", free_text trimado, briefing_id NULL, briefing table 0', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ft-persist@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post(
      { mode: 'free_text', freeText: '  bolo de cenoura com cobertura de chocolate  ' },
      headers,
    )
    expect(res.status).toBe(201)

    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.mode).toBe('free_text')
    expect(cs.freeText).toBe('bolo de cenoura com cobertura de chocolate')
    expect(cs.briefingId).toBeNull()

    // Sem briefing (o CHECK só exige briefing para structured): briefing table intacta.
    const bf = await db.select().from(briefing)
    expect(bf).toHaveLength(0)
    const c = await countsBriefing(sql)
    expect(c.briefing).toBe(0)
    expect(c.briefingItem).toBe(0)
  })

  // 87 pronto p/ free_text — receita gerada contraditória → Aviso pós-geração (só pós-gen,
  // sem briefing).
  it('87 em free_text: receita gerada contraditória → 201 + aviso pós-geração (sem briefing)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft-aviso@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(
        undefined,
        cannedSuccess({
          restricoes: ['sem_gluten'],
          ingredientes: [{ rawText: 'farinha de trigo', quantidade: '300.000', unidade: 'g' }],
        }),
      ),
    )

    const res = await post(
      { mode: 'free_text', freeText: 'pão caseiro fofinho de liquidificador' },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse
    expect(json.avisos).toHaveLength(1)
    expect(json.avisos![0].restricao).toBe('sem_gluten')
    expect(json.avisos![0].alergeno).toBe('trigo')
  })
})
