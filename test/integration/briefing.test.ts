import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq, asc } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import type { ClaudeClient } from '@/server/claude/client'
import { FakeClaudeClient } from '@/server/claude/client'
import { recipe, briefing, briefingItem, creationSession } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedIngredient } from '../helpers/recipes'
import {
  cannedSuccess,
  cannedImpossible,
  cannedRefusal,
  makeBriefing,
  countsBriefing,
  post,
} from '../helpers/generation'

/**
 * Modo estruturado — Briefing de geração pela PORTA MAIS ALTA (issue #11, §7.1). O handler
 * POST /api/generations com `{ mode:'structured', briefing:{…} }` contra o Postgres real,
 * com o seam do Claude trocado por `FakeClaudeClient(undefined, canned)`. `setup.ts` faz
 * `resetDeps()` + `truncateAll` antes de cada teste.
 *
 * O Briefing é o PEDIDO (entrada estruturada), persistido como PROVENIÊNCIA distinta da
 * Receita ENTREGUE. A Receita nasce SEMPRE `private`, `origin=ai_structured`, no MESMO
 * schema canônico — #11 muda só a ENTRADA. O Aviso (#7) é anexado INLINE, NÃO-bloqueante,
 * SÓ no 201 com Receita entregue (impossible/200 não carrega Aviso, E7).
 *
 * Invariantes de banco (CHECK 23514) via cliente RAW postgres-js (`makeSql`) — só assim o
 * PostgresError carrega `.code` no TOPO. PKs são uuid não-determinístico: asserir sempre
 * pelo id RETORNADO/headers. Os casos pre-seam provam o corte ANTES do seam com
 * `ExplodingClaudeClient` + `countsBriefing()==0` (recipe/session/generation/briefing/
 * briefing_item todos zero — E9).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Cliente que ESTOURA se o seam for tocado — prova que a validação curto-circuitou antes. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('ExplodingClaudeClient.echo não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: o briefing devia ter sido rejeitado ANTES da geração')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('seam tocado: streamConversation não devia ser chamado')
  }
}

/** Shape parcial da resposta 201 do modo estruturado (avisos AUSENTE quando sem contradição). */
type AvisoView = { kind: string; restricao: string; alergeno: string; mensagem: string }
type GenResponse = {
  outcome: string
  recipeId: string | null
  advisory: string | null
  avisos?: AvisoView[]
}

describe('POST /api/generations — Briefing estruturado (#11)', () => {
  // 1 — AC1: Briefing válido + success → 201; Receita private/ai_structured/success do dono;
  // creation_session.briefing_id setado; briefing (escalares) + briefing_item[] gravados.
  it('AC1: briefing válido + SUCCESS → 201; Receita private/ai_structured + briefing persistido', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ac1@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse
    expect(json.outcome).toBe('success')
    expect(json.recipeId).toBeTruthy()

    const db = getDb()
    // Receita ENTREGUE: nasce privada, origin por mode (structured → ai_structured), do dono.
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, json.recipeId!))
    expect(rec.origin).toBe('ai_structured')
    expect(rec.visibility).toBe('private')
    expect(rec.resultKind).toBe('success')
    expect(rec.ownerId).toBe(userId)

    // creation_session aponta para AMBOS: a Receita (recipe_id) E o Briefing (briefing_id).
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.mode).toBe('structured')
    expect(cs.recipeId).toBe(json.recipeId)
    expect(cs.briefingId).toBeTruthy()

    // briefing (escalares): os do makeBriefing.
    const [bf] = await db.select().from(briefing).where(eq(briefing.id, cs.briefingId!))
    expect(bf.cozinha).toBe('brasileira')
    expect(bf.porcoes).toBe(4)
    expect(bf.dificuldade).toBe(2)
    expect(bf.restricoes).toEqual([])

    // briefing_item[]: força/raw_text/ordem; quantidade STRING (numeric), nunca number.
    const items = await db
      .select()
      .from(briefingItem)
      .where(eq(briefingItem.briefingId, cs.briefingId!))
      .orderBy(asc(briefingItem.ordem))
    expect(items).toHaveLength(1)
    expect(items[0].strength).toBe('required')
    expect(items[0].rawText).toBe('arroz cozido')
    expect(items[0].ordem).toBe(0)
    expect(items[0].ingredientId).toBeNull()
    expect(typeof items[0].quantidade).toBe('string')
    expect(items[0].quantidade).toBe('2.000')
  })

  // 2 — AC2 (CHECK de banco): mode=structured SEM briefing é rejeitado pelo
  // creation_session_structured_briefing_chk (23514). Seedar um usuário e fornecer user_id
  // válido evita o 23502 (NOT NULL) de omitir user_id. O CHECK é avaliado ANTES da validação
  // de FK, então qualquer user_id (válido ou não) resulta em 23514 — nunca 23503.
  it('AC2: INSERT cru creation_session(mode=structured, briefing_id NULL) ⇒ 23514', async () => {
    const { userId } = await seedSessionHeaders({ email: 'chk@briefing.test' })

    let err: unknown
    try {
      await sql`
        INSERT INTO creation_session (user_id, mode, briefing_id)
        VALUES (${userId}, 'structured', NULL)
      `
    } catch (e) {
      err = e
    }
    expect((err as { code?: string }).code).toBe('23514')
  })

  // 3 — AC3: item raw-text-only (FK null) + item referenciando um ingredient seedado → ambos
  // persistem; briefing_item.ingredient_id resolvido vs null.
  it('AC3: item raw-text-only + item com ingredientId resolvido → ambos persistem', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ac3@briefing.test' })
    const ingId = await seedIngredient({ slug: 'arroz' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const brief = makeBriefing({
      itens: [
        {
          ingredientId: null,
          rawText: 'sal a gosto',
          quantidade: null,
          unidade: 'a_gosto',
          strength: 'preferred',
        },
        {
          ingredientId: ingId,
          rawText: null,
          quantidade: '2.000',
          unidade: 'xicara',
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(201)

    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    const items = await db
      .select()
      .from(briefingItem)
      .where(eq(briefingItem.briefingId, cs.briefingId!))
      .orderBy(asc(briefingItem.ordem))
    expect(items).toHaveLength(2)
    // Item 0: raw-text-only (FK null).
    expect(items[0].ingredientId).toBeNull()
    expect(items[0].rawText).toBe('sal a gosto')
    // Item 1: FK resolvida ao ingredient seedado.
    expect(items[1].ingredientId).toBe(ingId)
    expect(items[1].rawText).toBeNull()
  })

  // 4 — AC4 (proveniência pedido vs entregue): o PEDIDO (briefing.restricoes) difere da
  // ENTREGA (recipe.restricoes vinda do fake) — provam-se distintos pela creation_session.
  it('AC4: briefing (pedido) distinto da Receita (entregue) — restricoes divergem', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ac4@briefing.test' })
    // fake devolve recipe com restricoes:['sem_gluten'] (makeReceita default).
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ restricoes: ['vegano'] }) },
      headers,
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse

    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    const [bf] = await db.select().from(briefing).where(eq(briefing.id, cs.briefingId!))
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, json.recipeId!))

    // PEDIDO: o que o usuário pediu.
    expect(bf.restricoes).toEqual(['vegano'])
    // ENTREGUE: o que o modelo produziu (distinto do pedido).
    expect(rec.restricoes).toEqual(['sem_gluten'])
  })

  // 5 — AC5 (Aviso, ingredient seedado com alergenos): contradição óbvia trigo×sem_gluten →
  // 201 + avisos:[{restricao:'sem_gluten', alergeno:'trigo', mensagem}] (pt-BR "sem glúten").
  // A Receita AINDA persiste (não-bloqueante).
  it('AC5: sem_gluten + item FK com alergenos["trigo"] → 201 + aviso de contradição (pt-BR)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ac5@briefing.test' })
    const ingId = await seedIngredient({ slug: 'farinha-trigo', alergenos: ['trigo'] })
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

    // A Receita AINDA persiste (Aviso não-bloqueante).
    expect(json.recipeId).toBeTruthy()

    // avisos PRESENTE, 1 entrada, códigos do domínio + mensagem com RÓTULO amigável pt-BR.
    expect(json.avisos).toBeDefined()
    expect(json.avisos).toHaveLength(1)
    const aviso = json.avisos![0]
    expect(aviso.kind).toBe('contradicao')
    expect(aviso.restricao).toBe('sem_gluten')
    expect(aviso.alergeno).toBe('trigo')
    expect(aviso.mensagem).toContain('sem glúten')
    expect(aviso.mensagem).not.toContain('sem_gluten')
    expect(aviso.mensagem).toContain('trigo')
  })

  // 5b — AC5 variante en-US via ?locale=en-US (única via — parseRequestLocale só lê ?locale,
  // E8) → mensagem com rótulo en "gluten-free".
  it('AC5 (en-US): mesmo briefing com ?locale=en-US → mensagem com "gluten-free"', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ac5en@briefing.test' })
    const ingId = await seedIngredient({ slug: 'wheat-flour', alergenos: ['trigo'] })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const brief = makeBriefing({
      restricoes: ['sem_gluten'],
      itens: [
        {
          ingredientId: ingId,
          rawText: null,
          quantidade: null,
          unidade: null,
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers, 'en-US')
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse

    expect(json.avisos).toHaveLength(1)
    const aviso = json.avisos![0]
    // CÓDIGOS idênticos (locale-neutros); só a mensagem é localizada.
    expect(aviso.restricao).toBe('sem_gluten')
    expect(aviso.alergeno).toBe('trigo')
    expect(aviso.mensagem).toContain('gluten-free')
    expect(aviso.mensagem).not.toContain('sem_gluten')
  })

  // 6 — AC5 negativo: restrição + alérgeno CONSISTENTE (não contradiz) → SEM avisos na
  // resposta (ausente ≠ vazio).
  it('AC5 negativo: sem_gluten + item FK com alergenos["leite"] (consistente) → SEM avisos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ac5neg@briefing.test' })
    const ingId = await seedIngredient({ slug: 'leite', alergenos: ['leite'] })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const brief = makeBriefing({
      restricoes: ['sem_gluten'],
      itens: [
        {
          ingredientId: ingId,
          rawText: null,
          quantidade: null,
          unidade: null,
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse
    // ausente ≠ vazio: a chave não sobrevive à serialização quando não há contradição.
    expect(json).not.toHaveProperty('avisos')
  })

  // 7 — AC5 sem catálogo: restrição + item raw-text-only (FK null) → SEM avisos (motor inerte
  // sem dado de alérgeno — correto por design).
  it('AC5 sem catálogo: sem_gluten + item raw-text-only "farinha de trigo" → SEM avisos', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ac5sc@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const brief = makeBriefing({
      restricoes: ['sem_gluten'],
      itens: [
        {
          ingredientId: null,
          rawText: 'farinha de trigo',
          quantidade: null,
          unidade: null,
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as GenResponse
    expect(json).not.toHaveProperty('avisos')
  })

  // 8 — AC6 dedup restrições: ['vegano','vegano'] → briefing.restricoes == ['vegano'].
  it('AC6 dedup restrições: vegano duplicado → 1 valor persistido', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dedupr@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ restricoes: ['vegano', 'vegano'] }) },
      headers,
    )
    expect(res.status).toBe(201)

    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    const [bf] = await db.select().from(briefing).where(eq(briefing.id, cs.briefingId!))
    expect(bf.restricoes).toEqual(['vegano'])
  })

  // 9 — AC6 dedup itens: "Farinha"/"farinha" (case/normalização) → 1 briefing_item.
  it('AC6 dedup itens: "Farinha" e "farinha" → 1 item persistido', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dedupi@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const brief = makeBriefing({
      itens: [
        { ingredientId: null, rawText: 'Farinha', quantidade: null, unidade: null, strength: 'required' },
        { ingredientId: null, rawText: 'farinha', quantidade: null, unidade: null, strength: 'preferred' },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(201)

    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    const items = await db
      .select()
      .from(briefingItem)
      .where(eq(briefingItem.briefingId, cs.briefingId!))
    expect(items).toHaveLength(1)
    // Primeira ocorrência vence (ordem preservada).
    expect(items[0].rawText).toBe('Farinha')
  })

  // 10 — AC6 briefing_vazio: briefing {} + ExplodingClaudeClient → 400; seam NÃO tocado;
  // counts E briefing/briefing_item count == 0 (E9).
  it('AC6 briefing_vazio: briefing {} → 400; nada persistido (seam intocado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'vazio@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'structured', briefing: {} }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'briefing_vazio' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 11 — AC6 faixa inválida: porcoes:999 + ExplodingClaudeClient → 400 porcoes_fora_de_faixa;
  // nada persistido (E9).
  it('AC6 faixa inválida: porcoes:999 → 400 porcoes_fora_de_faixa; nada persistido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'porcoes@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ porcoes: 999 }) },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'porcoes_fora_de_faixa' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 12 — observacoes_muito_longas: 2001 chars + ExplodingClaudeClient → 400; nada persistido (E9).
  it('observacoes_muito_longas: 2001 chars → 400; nada persistido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'obs@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ observacoes: 'a'.repeat(2001) }) },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'observacoes_muito_longas' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 12a — strength_invalida (prova direta da decisão #3 na porta mais alta, E4): item sem
  // strength (ou fora de STRENGTHS) + ExplodingClaudeClient → 400; corte antes do seam.
  it('strength_invalida: item com strength fora de STRENGTHS → 400; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'strength@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const brief = makeBriefing({
      itens: [
        // strength fora de {required, preferred} — viola a decisão #3.
        { ingredientId: null, rawText: 'arroz', quantidade: null, unidade: null, strength: 'maybe' as never },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'strength_invalida' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 12b — briefing_invalido (E4): briefing NÃO-objeto + ExplodingClaudeClient → 400.
  it('briefing_invalido: briefing não-objeto → 400; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'invalido@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'structured', briefing: 'x' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'briefing_invalido' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 12c — dificuldade_fora_de_faixa (paridade com generation.test.ts:339, E4): dificuldade:99
  // + ExplodingClaudeClient → 400.
  it('dificuldade_fora_de_faixa: dificuldade:99 → 400; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'dif@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ dificuldade: 99 }) },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dificuldade_fora_de_faixa' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 12d — ingrediente_inexistente (E2): ingredientId uuid BEM-FORMADO mas INEXISTENTE +
  // ExplodingClaudeClient → 400; o SELECT antecipado corta ANTES do seam (sem gastar LLM).
  it('ingrediente_inexistente: ingredientId uuid bem-formado inexistente → 400; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'inexistente@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const brief = makeBriefing({
      itens: [
        {
          ingredientId: '00000000-0000-0000-0000-000000000000',
          rawText: null,
          quantidade: null,
          unidade: null,
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'ingrediente_inexistente' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 12e — ingrediente_inexistente (forma MALFORMADA, E2): ingredientId NÃO-uuid ('abc') +
  // ExplodingClaudeClient → 400. parseBriefing só checa `typeof === 'string'`; o guard isUuid
  // no handler corta ANTES de tocar a coluna uuid (evita 22P02/500) e ANTES do seam — mesma
  // política not_found: malformado é indistinguível de inexistente para o cliente.
  it('ingrediente_inexistente: ingredientId malformado (não-uuid) → 400; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'malformado@briefing.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const brief = makeBriefing({
      itens: [
        {
          ingredientId: 'abc',
          rawText: 'x',
          quantidade: null,
          unidade: null,
          strength: 'required',
        },
      ],
    })
    const res = await post({ mode: 'structured', briefing: brief }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'ingrediente_inexistente' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 13 — impossible com briefing: cannedImpossible() + briefing → 200; briefing persistido,
  // creation_session.briefing_id setado, recipe count 0 (pedido sobrevive sem entrega; AC4).
  // SEM avisos na resposta (impossible não carrega Aviso, §4.4/E7).
  it('impossible com briefing → 200; briefing persistido, recipe 0, SEM avisos', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'imp@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedImpossible()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(200)
    const json = (await res.json()) as GenResponse
    expect(json.outcome).toBe('impossible')
    // Impossible não carrega Aviso (E7), mesmo que o briefing tivesse contradição.
    expect(json).not.toHaveProperty('avisos')

    // O PEDIDO sobrevive sem entrega: briefing persistido, sessão aponta para ele, recipe 0.
    const c = await countsBriefing(sql)
    expect(c.recipe).toBe(0)
    expect(c.briefing).toBe(1)
    expect(c.briefingItem).toBe(1)

    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.recipeId).toBeNull()
    expect(cs.briefingId).toBeTruthy()
  })

  // 14 — invalid NÃO persiste briefing: cannedRefusal() + briefing → 502; tudo 0 (briefing
  // não nasce em erro de sistema puro).
  it('invalid (refusal) com briefing → 502; nada persistido (nem briefing)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'inv@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedRefusal()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: 'geracao_invalida' })
    expect(await countsBriefing(sql)).toEqual({
      recipe: 0,
      session: 0,
      generation: 0,
      briefing: 0,
      briefingItem: 0,
    })
  })

  // 15 — regeneração = nova versão: dois POST com o mesmo briefing → 2 generations, 2 recipes,
  // 2 briefings; nada destruído (espelha generation.test.ts:294).
  it('regeneração = nova versão: dois POST com o mesmo briefing → 2 recipes/generations/briefings', async () => {
    const { headers } = await seedSessionHeaders({ email: 'regen@briefing.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const r1 = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(r1.status).toBe(201)
    const r2 = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(r2.status).toBe(201)

    const j1 = (await r1.json()) as GenResponse
    const j2 = (await r2.json()) as GenResponse
    // Nada destruído/sobrescrito: cada POST cria uma Receita NOVA.
    expect(j1.recipeId).not.toBe(j2.recipeId)

    const c = await countsBriefing(sql)
    expect(c.recipe).toBe(2)
    expect(c.generation).toBe(2)
    expect(c.briefing).toBe(2)
  })
})
