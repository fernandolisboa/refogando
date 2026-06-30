import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient, setEmbedder } from '@/server/deps'
import type { ClaudeClient, ConversationStreamInput } from '@/server/claude/client'
import { FakeClaudeClient } from '@/server/claude/client'
import { FakeEmbedder } from '@/server/embedding/embedder'
import type { GenerationOutput } from '@/domain/generation'
import { POST } from '@/app/api/conversations/stream/route'
import { persistGeneration } from '@/server/generation/persist'
import { recipe, recipeTranslation, recipeIngredient, recipeEmbedding, creationSession, generation, transcriptMessage, appConfig } from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import type { RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { seedSessionHeaders } from '../helpers/users'
import {
  cannedSuccess,
  cannedDegraded,
  cannedPlayful,
  cannedImpossible,
  cannedRefusal,
  cannedMaxTokens,
  cannedParseFailed,
} from '../helpers/generation'
import { makeTranscript, cannedTokens, postStream, collectNdjson } from '../helpers/conversation'

/**
 * Contrato do modo conversa (#12) pela porta mais alta — POST /api/conversations/stream
 * contra o Postgres real, com o seam do Claude trocado por
 * `FakeClaudeClient(undefined, canned, cannedTokens)`. `setup.ts` faz `resetDeps()` +
 * `truncateAll` antes de cada teste.
 *
 * WIRE = NDJSON: zero-ou-mais {type:'token'} durante o stream, depois EXATAMENTE UM frame
 * terminal ({type:'recipe'} | {type:'impossible'} | {type:'error'}). O frame {type:'recipe'}
 * ESPELHA o 201 de POST /api/generations ({outcome,recipeId,advisory,avisos?}).
 *
 * ASSIMETRIA DE TRANSPORTE (documentada na rota): o caminho structured devolve 502 para
 * INVALID, mas na conversa a destilação roda DEPOIS do stream abrir → INVALID NÃO pode usar
 * status HTTP (headers já enviados) → é SEMPRE o frame in-band {type:'error'}.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** Cliente que ESTOURA se o seam for tocado — prova o corte ANTES de abrir o stream. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('ExplodingClaudeClient.echo não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: generateRecipe não devia ser chamado')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('seam tocado: a validação devia ter cortado ANTES de abrir o stream')
  }
  async extractIngredients(): Promise<never> {
    throw new Error('seam tocado: extractIngredients não devia ser chamado')
  }
}

/** Contagens cruas das tabelas tocáveis (porta alta, sem ORM). `transcript` (#15) cobre as
 * falas duráveis: cada chamada bem-sucedida grava 2 (turno do Usuário + resposta do Assistente). */
async function counts(): Promise<{ recipe: number; session: number; generation: number; transcript: number }> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipe`
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
  const [g] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM transcript_message`
  return { recipe: r.n, session: s.n, generation: g.n, transcript: t.n }
}

describe('POST /api/conversations/stream — taxonomia e wire NDJSON', () => {
  it('SUCCESS: streama tokens em ordem, depois {type:recipe}; persiste recipe privada ai_chat + sessão + generation', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'conv-ok@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['Vou ', 'pensar…'])),
    )

    const res = await postStream({ transcript: makeTranscript() }, headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/x-ndjson')

    const frames = await collectNdjson(res)
    // ≥1 token, em ordem, antes do terminal.
    const tokens = frames.filter((f) => f.type === 'token')
    expect(tokens.length).toBeGreaterThanOrEqual(1)
    expect(tokens.map((f) => (f.type === 'token' ? f.text : ''))).toEqual(['Vou ', 'pensar…'])

    // EXATAMENTE um frame terminal, e é o último.
    const terminal = frames[frames.length - 1]
    expect(terminal.type).toBe('recipe')
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    expect(terminal.outcome).toBe('success')
    expect(terminal.recipeId).toBeTruthy()
    expect(terminal.advisory).toBe('Dica: use arroz do dia anterior.')

    // Recipe: privada, origin ai_chat, result_kind success, dono = caller.
    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, terminal.recipeId!))
    expect(rec.origin).toBe('ai_chat')
    expect(rec.visibility).toBe('private')
    expect(rec.resultKind).toBe('success')
    expect(rec.ownerId).toBe(userId)

    // Translation + ingredientes persistidos.
    const [tr] = await db
      .select()
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, terminal.recipeId!))
    expect(tr.titulo).toBe('Arroz de forno')
    const ings = await db
      .select()
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, terminal.recipeId!))
    expect(ings.length).toBe(2)

    // creation_session(mode='conversation') + generation(advisory set, recipe_id set).
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.mode).toBe('conversation')
    expect(cs.recipeId).toBe(terminal.recipeId)
    const [gen] = await db.select().from(generation).where(eq(generation.recipeId, terminal.recipeId!))
    expect(gen.recipeId).toBe(terminal.recipeId)
    expect(gen.advisoryComment).toBe('Dica: use arroz do dia anterior.')

    // #15: EXATAMENTE uma Session (lazy-create + destilação anexa por UPDATE, não 2ª INSERT)
    // e 2 falas duráveis (turno do Usuário + resposta do Assistente) com seq 0,1.
    const c = await counts()
    expect(c.session).toBe(1)
    expect(c.transcript).toBe(2)
    const msgs = await sql<{ role: string; content: string; seq: number }[]>`
      SELECT role, content, seq FROM transcript_message WHERE creation_session_id = ${cs.id} ORDER BY seq`
    expect(msgs).toEqual([
      { role: 'user', content: 'arroz de forno com queijo', seq: 0 },
      { role: 'assistant', content: 'Vou pensar…', seq: 1 },
    ])
  })

  it('#119: a Receita destilada ganha embedding (best-effort) p/ a Busca semântica', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-embed@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['oi'])))
    setEmbedder(new FakeEmbedder(EMBEDDING_DIMENSIONS)) // 1536 — casa vector(1536)

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')

    const [emb] = await getDb()
      .select({ dims: dsql`array_length(${recipeEmbedding.embedding}::real[], 1)`.mapWith(Number) })
      .from(recipeEmbedding)
      .where(and(eq(recipeEmbedding.recipeId, terminal.recipeId!), eq(recipeEmbedding.locale, 'pt-BR')))
    expect(emb?.dims).toBe(EMBEDDING_DIMENSIONS)
  })

  it('#119: embedder INDISPONÍVEL na conversa NÃO derruba o turno (degrada — Receita persiste)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-embed-throw@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['oi'])))
    // Sem setEmbedder ⇒ RealEmbedder default LANÇA (sem key) — o embed best-effort engole.
    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    expect(terminal.type).toBe('recipe') // o turno conclui mesmo sem embedding
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    expect(terminal.recipeId).toBeTruthy()
    expect((await counts()).recipe).toBe(1) // a Receita persiste
  })

  it('DEGRADED → {type:recipe,outcome:degraded}; result_kind degraded; advisory na generation', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-deg@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(undefined, cannedDegraded({}, 'ajustei a receita'), cannedTokens()),
    )

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    expect(terminal.type).toBe('recipe')
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    expect(terminal.outcome).toBe('degraded')

    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, terminal.recipeId!))
    expect(rec.resultKind).toBe('degraded')
    const [gen] = await db.select().from(generation).where(eq(generation.recipeId, terminal.recipeId!))
    expect(gen.outcome).toBe('degraded')
    expect(gen.advisoryComment).toBe('ajustei a receita')
  })

  // MIGRADO de generation.test.ts:177 (PLAYFUL via mode:'conversation' → 201) — agora frame terminal.
  it('PLAYFUL (migrado) → {type:recipe,outcome:playful}; recipe SEMPRE privada', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-play@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedPlayful(), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    expect(terminal.type).toBe('recipe')
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    expect(terminal.outcome).toBe('playful')

    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, terminal.recipeId!))
    expect(rec.resultKind).toBe('playful')
    expect(rec.visibility).toBe('private')
  })

  // MIGRADO de generation.test.ts:272-282 (origin por mode: conversation ⇒ ai_chat).
  it('origin por mode (migrado): receita destilada → recipe.origin === ai_chat', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-origin@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    const [rec] = await getDb().select().from(recipe).where(eq(recipe.id, terminal.recipeId!))
    expect(rec.origin).toBe('ai_chat')
  })

  it('IMPOSSIBLE → {type:impossible}; ZERO recipe; creation_session(conversation)+generation(recipe_id NULL)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'conv-imp@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(undefined, cannedImpossible('Não dá pra fazer bolo só com água.'), cannedTokens()),
    )

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    expect(terminal.type).toBe('impossible')
    if (terminal.type !== 'impossible') throw new Error('terminal não é impossible')
    expect(terminal.advisory).toBe('Não dá pra fazer bolo só com água.')

    // ZERO recipe; mas HÁ episódio de criação. #15: UMA Session (impossible só bumpa
    // updated_at, recipe_id segue NULL — NÃO cria 2ª), 1 generation, 2 falas.
    const c = await counts()
    expect(c.recipe).toBe(0)
    expect(c.session).toBe(1)
    expect(c.generation).toBe(1)
    expect(c.transcript).toBe(2)
    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.mode).toBe('conversation')
    expect(cs.recipeId).toBeNull()
    const [gen] = await db.select().from(generation).where(eq(generation.creationSessionId, cs.id))
    expect(gen.recipeId).toBeNull()
    expect(gen.outcome).toBe('impossible')
    expect(gen.advisoryComment).toBe('Não dá pra fazer bolo só com água.')
  })

  it('INVALID via refusal → {type:error,geracao_invalida} IN-BAND (não 502); ZERO persistido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-ref@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedRefusal(), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    // Headers JÁ enviados (stream aberto) → 200, erro vai NO CORPO.
    expect(res.status).toBe(200)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    expect(terminal).toEqual({ type: 'error', error: 'geracao_invalida' })
    // #15: nenhuma generation/Receita (INVALID não é episódio de criação), mas a Session e
    // as 2 falas do turno JÁ foram gravadas (a conversa aconteceu; só a destilação falhou).
    expect(await counts()).toEqual({ recipe: 0, session: 1, generation: 0, transcript: 2 })
  })

  it('INVALID via max_tokens → {type:error}; sem generation/Receita; Session+Transcrição persistem', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-maxtok@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedMaxTokens(), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1]).toEqual({ type: 'error', error: 'geracao_invalida' })
    expect(await counts()).toEqual({ recipe: 0, session: 1, generation: 0, transcript: 2 })
  })

  it('INVALID via parse_failed → {type:error}; sem generation/Receita; Session+Transcrição persistem', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-parse@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedParseFailed(), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1]).toEqual({ type: 'error', error: 'geracao_invalida' })
    expect(await counts()).toEqual({ recipe: 0, session: 1, generation: 0, transcript: 2 })
  })

  it('INVALID via porcoes fora-de-faixa na saída destilada → {type:error}; sem generation (classify não clampa)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-range@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({ porcoes: 99 }), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1]).toEqual({ type: 'error', error: 'geracao_invalida' })
    expect(await counts()).toEqual({ recipe: 0, session: 1, generation: 0, transcript: 2 })
  })

  // MIGRADO de generation-postgen.test.ts:90 (87c conversation com receita contraditória).
  it('Aviso pós-geração (migrado): receita destilada sem_lactose + leite → terminal {type:recipe} com avisos; recipe persiste', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-aviso@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(
        undefined,
        cannedSuccess({
          restricoes: ['sem_lactose'],
          ingredientes: [{ nome: 'leite integral', quantidade: '500.000', unidade: 'ml' }],
        }),
        cannedTokens(),
      ),
    )

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    expect(terminal.type).toBe('recipe')
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    expect(terminal.avisos).toBeDefined()
    expect(terminal.avisos).toHaveLength(1)
    expect(terminal.avisos![0].restricao).toBe('sem_lactose')
    expect(terminal.avisos![0].alergeno).toBe('leite')

    // Não-bloqueante: a Receita persiste.
    expect(terminal.recipeId).toBeTruthy()
    expect((await counts()).recipe).toBe(1)
  })

  it('anon (sem headers) → 401 JSON ANTES do stream; o seam NUNCA é tocado; nada criado', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await postStream({ transcript: makeTranscript() })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })
  })

  it('transcript inválido (vazio / última não-user / mensagem grande / falas demais) → 400 JSON ANTES do stream', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-badtx@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    // vazio
    const r1 = await postStream({ transcript: [] }, headers)
    expect(r1.status).toBe(400)
    await expect(r1.json()).resolves.toMatchObject({ error: 'transcript_vazio' })

    // última fala não é do usuário
    const r2 = await postStream(
      { transcript: [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }] },
      headers,
    )
    expect(r2.status).toBe(400)
    await expect(r2.json()).resolves.toMatchObject({ error: 'ultima_fala_nao_usuario' })

    // mensagem grande demais
    const r3 = await postStream(
      { transcript: [{ role: 'user', content: 'a'.repeat(2001) }] },
      headers,
    )
    expect(r3.status).toBe(400)
    await expect(r3.json()).resolves.toMatchObject({ error: 'mensagem_muito_longa' })

    // falas demais
    const tooMany = Array.from({ length: 101 }, () => ({ role: 'user' as const, content: 'oi' }))
    const r4 = await postStream({ transcript: tooMany }, headers)
    expect(r4.status).toBe(400)
    await expect(r4.json()).resolves.toMatchObject({ error: 'transcript_muito_longo' })

    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })
  })

  it('#15: sessionId inexistente/não-uuid → lazy-create (NÃO escreve em sessão alheia)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-sid@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens()))

    // Um uuid que não existe (e portanto não é do caller) → fallback p/ lazy-create.
    const res = await postStream(
      { transcript: makeTranscript(), sessionId: '00000000-0000-0000-0000-000000000000' },
      headers,
    )
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1].type).toBe('recipe')
    // UMA Session nova (lazy-create), e NÃO a do uuid fornecido (que não existe).
    const c = await counts()
    expect(c.session).toBe(1)
    expect(c.transcript).toBe(2)
  })

  it('#15 IDOR: B POSTa com o sessionId REAL de A → lazy-create p/ B; a Session de A fica INTACTA', async () => {
    // User A: uma Session REAL própria, com Receita anexada e 2 falas (turno real).
    const { userId: aId } = await seedSessionHeaders({ email: 'conv-idor-a@gen.test' })
    const db = getDb()
    const aRecipeId = (
      await db
        .insert(recipe)
        .values({
          origin: 'ai_chat',
          visibility: 'private',
          resultKind: 'success',
          ownerId: aId,
          originalLocale: 'pt-BR',
        })
        .returning({ id: recipe.id })
    )[0].id
    const [aSession] = await db
      .insert(creationSession)
      .values({ userId: aId, mode: 'conversation', recipeId: aRecipeId })
      .returning({ id: creationSession.id })
    await db.insert(transcriptMessage).values([
      { creationSessionId: aSession.id, role: 'user', content: 'segredo de A', seq: 0 },
      { creationSessionId: aSession.id, role: 'assistant', content: 'resposta a A', seq: 1 },
    ])

    // User B POSTa um turno passando o sessionId REAL de A (tentativa de IDOR).
    const { userId: bId, headers: bHeaders } = await seedSessionHeaders({ email: 'conv-idor-b@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['oi'])))
    const res = await postStream({ transcript: makeTranscript(), sessionId: aSession.id }, bHeaders)
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1].type).toBe('recipe')

    // (1) B teve sucesso e ganhou uma Session NOVA própria (lazy-create fallback, posse fail-closed).
    const bSessions = await db.select().from(creationSession).where(eq(creationSession.userId, bId))
    expect(bSessions.length).toBe(1)
    expect(bSessions[0].id).not.toBe(aSession.id)
    const bMsgs = await db
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, bSessions[0].id))
    expect(bMsgs.length).toBe(2)

    // (2) A INTACTA: mesmo recipe_id, MESMAS 2 falas (conteúdo/seq), sem falas novas.
    const [aAfter] = await db.select().from(creationSession).where(eq(creationSession.id, aSession.id))
    expect(aAfter.recipeId).toBe(aRecipeId)
    const aMsgs = await sql<{ role: string; content: string; seq: number }[]>`
      SELECT role, content, seq FROM transcript_message WHERE creation_session_id = ${aSession.id} ORDER BY seq`
    expect(aMsgs).toEqual([
      { role: 'user', content: 'segredo de A', seq: 0 },
      { role: 'assistant', content: 'resposta a A', seq: 1 },
    ])

    // DUAS Sessions no total (A + a nova de B), 4 falas (2 de A + 2 de B).
    const c = await counts()
    expect(c.session).toBe(2)
    expect(c.transcript).toBe(4)
  })

  it('model resolvido de app_config.default_model → vai pra generation.model (default opus quando ausente)', async () => {
    // default ausente.
    {
      const { headers } = await seedSessionHeaders({ email: 'conv-defmodel@gen.test' })
      setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens()))
      const res = await postStream({ transcript: makeTranscript() }, headers)
      const frames = await collectNdjson(res)
      const terminal = frames[frames.length - 1]
      if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
      const [gen] = await getDb().select().from(generation).where(eq(generation.recipeId, terminal.recipeId!))
      expect(gen.model).toBe('claude-opus-4-8')
    }
  })

  it('model resolvido de app_config: linha presente → generation.model casa', async () => {
    await getDb().insert(appConfig).values({ id: true, defaultModel: 'claude-sonnet-4-6' })
    const { headers } = await seedSessionHeaders({ email: 'conv-model@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens()))

    const res = await postStream({ transcript: makeTranscript() }, headers)
    const frames = await collectNdjson(res)
    const terminal = frames[frames.length - 1]
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    const [gen] = await getDb().select().from(generation).where(eq(generation.recipeId, terminal.recipeId!))
    expect(gen.model).toBe('claude-sonnet-4-6')
  })

  it('ABORT: cliente desconecta após o 1º token → loop para; generateRecipe NÃO roda; nada persiste; sem terminal', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-abort@gen.test' })

    const controller = new AbortController()
    // Cliente instrumentado e DETERMINÍSTICO: rende o 1º token, depois ESPERA o abort do
    // request antes de tentar o 2º — ao ver `signal.aborted`, RETORNA (loop encerra). Sem
    // essa espera, o producer poderia enfileirar todos os tokens antes do reader abortar
    // (enqueue não bloqueia). `generateRecipe` SINALIZA se a destilação for tocada (não deve).
    // `streamFinished` resolve quando o generator completa → ponto de sincronia determinístico.
    let recipeCalled = false
    let resolveFinished!: () => void
    const streamFinished = new Promise<void>((r) => {
      resolveFinished = r
    })
    class AbortProbeClient implements ClaudeClient {
      async echo(text: string): Promise<string> {
        return text
      }
      async *streamConversation(input: ConversationStreamInput): AsyncIterable<string> {
        try {
          yield 't1 '
          // Espera o request ser abortado (o teste aborta após ler o 1º token), depois para.
          await new Promise<void>((resolve) => {
            if (input.signal?.aborted) return resolve()
            input.signal?.addEventListener('abort', () => resolve(), { once: true })
          })
          if (input.signal?.aborted) return
          yield 't2 ' // inalcançável quando abortado — prova de que o loop parou.
        } finally {
          resolveFinished()
        }
      }
      async generateRecipe(): Promise<GenerationOutput> {
        recipeCalled = true
        return cannedSuccess()
      }
      async extractIngredients(): Promise<{ kind: 'parse_failed' }> {
        return { kind: 'parse_failed' }
      }
    }
    setClaudeClient(new AbortProbeClient())

    // Request COM signal de abort (o que a porta HTTP faz num disconnect real).
    const req = new Request('http://localhost/api/conversations/stream', {
      method: 'POST',
      headers,
      body: JSON.stringify({ transcript: makeTranscript() }),
      signal: controller.signal,
    })
    const res = await POST(req)
    expect(res.status).toBe(200)

    // Lê o 1º frame (token), ABORTA (cliente desconecta), e PARA de ler — um cliente
    // desconectado não lê mais. A rota não emite terminal nem fecha o stream p/ um request
    // abortado (não há cliente p/ receber), então não se drena o reader: usa-se `streamFinished`.
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const { value } = await reader.read()
    const firstLine = decoder.decode(value).trim().split('\n')[0]
    const firstFrame = JSON.parse(firstLine) as { type: string; text?: string }
    expect(firstFrame).toEqual({ type: 'token', text: 't1 ' })

    controller.abort()
    await streamFinished // o generator encerrou (RETORNOU no abort, sem chegar ao 't2 ').

    // Destilação pulada e NADA persistido (a rota viu signal.aborted e retornou).
    expect(recipeCalled).toBe(false)
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })

    await reader.cancel() // libera o lock; o request abortado não tem cliente p/ o resto.
  })
})

describe('persistGeneration — existingSessionId RETOMA a sessão (#15, REAL)', () => {
  it('success com existingSessionId → UPDATE recipe_id na MESMA sessão (não cria 2ª) + nova generation', async () => {
    const { userId } = await seedSessionHeaders({ email: 'conv-reuse@gen.test' })

    // Cria a 1ª sessão (success) — uma creation_session existe, com sua Receita.
    const first = await persistGeneration({
      result: { outcome: 'success', recipe: cannedSuccessRecipe(), advisory: null },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: userId,
      model: 'claude-opus-4-8',
    })
    expect(first).not.toBeNull()
    expect((await counts()).session).toBe(1)

    // Re-destilar passando existingSessionId RETOMA: UPDATE de recipe_id na MESMA sessão.
    const second = await persistGeneration({
      result: { outcome: 'success', recipe: cannedSuccessRecipe(), advisory: 'nova dica' },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: userId,
      model: 'claude-opus-4-8',
      existingSessionId: first!.creationSessionId,
    })
    expect(second).not.toBeNull()
    // AINDA UMA sessão (UPDATE, não INSERT), e é a MESMA; mas DUAS generation (múltiplas/sessão).
    expect((await counts()).session).toBe(1)
    expect(second!.creationSessionId).toBe(first!.creationSessionId)
    expect((await counts()).generation).toBe(2)
    const db = getDb()
    const [cs] = await db
      .select()
      .from(creationSession)
      .where(eq(creationSession.id, first!.creationSessionId))
    // recipe_id passou a apontar para a Receita da 2ª destilação.
    expect(cs.recipeId).toBe(second!.recipeId)
  })

  it('impossible com existingSessionId → só bumpa updated_at (recipe_id segue NULL); não cria 2ª sessão', async () => {
    const { userId } = await seedSessionHeaders({ email: 'conv-reuse-imp@gen.test' })

    // 1ª destilação success cria a sessão com Receita.
    const first = await persistGeneration({
      result: { outcome: 'success', recipe: cannedSuccessRecipe(), advisory: null },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: userId,
      model: 'claude-opus-4-8',
    })
    expect((await counts()).session).toBe(1)

    // Re-destilar impossible NA mesma sessão: NÃO cria 2ª, recipe_id segue o que estava (não NULL
    // — impossible não zera recipe_id, só não o atualiza; o caminho impossible deixa recipe_id como está).
    const recipeBefore = first!.recipeId
    const second = await persistGeneration({
      result: { outcome: 'impossible', advisory: 'não dá' },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: userId,
      model: 'claude-opus-4-8',
      existingSessionId: first!.creationSessionId,
    })
    expect(second!.creationSessionId).toBe(first!.creationSessionId)
    expect(second!.recipeId).toBeNull()
    expect((await counts()).session).toBe(1)
    expect((await counts()).generation).toBe(2)
    const db = getDb()
    const [cs] = await db
      .select()
      .from(creationSession)
      .where(eq(creationSession.id, first!.creationSessionId))
    // impossible UPDATE-only NÃO toca recipe_id: segue apontando p/ a Receita da 1ª destilação.
    expect(cs.recipeId).toBe(recipeBefore)
  })

  it('impossible-após-impossible com existingSessionId → recipe_id segue NULL; 1 Session, 2ª generation', async () => {
    const { userId } = await seedSessionHeaders({ email: 'conv-reuse-impimp@gen.test' })

    // 1ª destilação IMPOSSIBLE cria a Session SEM Receita (recipe_id NULL).
    const first = await persistGeneration({
      result: { outcome: 'impossible', advisory: 'não dá (1)' },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: userId,
      model: 'claude-opus-4-8',
    })
    expect(first!.recipeId).toBeNull()
    const c1 = await counts()
    expect(c1.session).toBe(1)
    expect(c1.recipe).toBe(0)
    expect(c1.generation).toBe(1)

    // 2ª IMPOSSIBLE NA mesma Session: NÃO cria 2ª Session, recipe_id segue NULL, 2ª generation.
    const second = await persistGeneration({
      result: { outcome: 'impossible', advisory: 'não dá (2)' },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: userId,
      model: 'claude-opus-4-8',
      existingSessionId: first!.creationSessionId,
    })
    expect(second!.creationSessionId).toBe(first!.creationSessionId)
    expect(second!.recipeId).toBeNull()

    const c2 = await counts()
    expect(c2.session).toBe(1) // ainda UMA Session
    expect(c2.recipe).toBe(0) // nunca nasceu Receita
    expect(c2.generation).toBe(2) // 2ª generation existe
    const [cs] = await getDb()
      .select()
      .from(creationSession)
      .where(eq(creationSession.id, first!.creationSessionId))
    expect(cs.recipeId).toBeNull() // recipe_id permanece NULL após o 2º impossible
  })

  it('defense-in-depth: existingSessionId de OUTRO Usuário → ESTOURA e NÃO muta a sessão alheia (nem insere generation)', async () => {
    // Sessão de A (criada pela própria destilação de A).
    const { userId: aId } = await seedSessionHeaders({ email: 'conv-persist-idor-a@gen.test' })
    const aGen = await persistGeneration({
      result: { outcome: 'success', recipe: cannedSuccessRecipe(), advisory: 'dica de A' },
      mode: 'conversation',
      origin: 'ai_chat',
      ownerId: aId,
      model: 'claude-opus-4-8',
    })
    const aSessionId = aGen!.creationSessionId
    const before = await counts()

    // B tenta persistir uma geração anexando a Session de A (só dispara num bug do route).
    const { userId: bId } = await seedSessionHeaders({ email: 'conv-persist-idor-b@gen.test' })
    await expect(
      persistGeneration({
        result: { outcome: 'success', recipe: cannedSuccessRecipe(), advisory: 'tentativa de B' },
        mode: 'conversation',
        origin: 'ai_chat',
        ownerId: bId,
        model: 'claude-opus-4-8',
        existingSessionId: aSessionId,
      }),
    ).rejects.toThrow(/não-possuído|nao-possuido|fail-closed/i)

    // Sessão de A INTACTA: recipe_id e dono inalterados; NENHUMA generation nova (tx reverteu).
    const db = getDb()
    const [aAfter] = await db.select().from(creationSession).where(eq(creationSession.id, aSessionId))
    expect(aAfter.userId).toBe(aId)
    expect(aAfter.recipeId).toBe(aGen!.recipeId)
    // Contagens globais inalteradas (a Receita de B até pode ter sido inserida na tx, mas a tx
    // reverteu inteira ao estourar — nada persiste). generation segue só a de A.
    expect(await counts()).toEqual(before)
  })
})

/**
 * Teto diário de geração de RECEITA por papel (#167) NO MODO CONVERSA — a brecha que o gate de
 * /api/generations sozinho deixava: a conversa também faz a chamada PAGA generateRecipe (destilação)
 * e persiste uma `generation` que CONTA pro teto. Sem o gate aqui, um usuário que estoura o teto no
 * structured/free_text continuava gerando via chat. Prova: estourado ⇒ 429 limite_geracao JSON ANTES
 * de abrir o stream (o seam NÃO é tocado — nem streamConversation, nem a destilação); abaixo ⇒ stream
 * normal; admin (∞) ignora; cap da CONFIG do admin substitui o default.
 */
describe('POST /api/conversations/stream — teto de geração por papel (#167)', () => {
  /** Semeia N gerações JÁ persistidas do usuário (a fonte do teto): 1 sessão + N generation nela. */
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

  async function setRecipeGenCap(caps: RecipeGenCapByRole): Promise<void> {
    await getDb()
      .insert(appConfig)
      .values({ id: true, recipeGenCapByRole: caps })
      .onConflictDoUpdate({ target: appConfig.id, set: { recipeGenCapByRole: caps } })
  }

  it('no teto (usuario default 10, com 10 gerações) → 429 limite_geracao ANTES do stream; seam NÃO tocado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'conv-at@cap.test' })
    await seedGenerationsForUser(userId, 10)
    setClaudeClient(new ExplodingClaudeClient()) // estoura se streamConversation OU generateRecipe for tocado
    const before = await counts()

    const res = await postStream({ transcript: makeTranscript() }, headers)
    expect(res.status).toBe(429)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
    // Nada novo nasceu: sem stream, sem destilação, sem 2 falas, sem generation.
    expect(await counts()).toEqual(before)
  })

  it('abaixo do teto (usuario default 10, com 9 gerações) → stream normal (200) + {type:recipe}', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'conv-below@cap.test' })
    await seedGenerationsForUser(userId, 9)
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens()))
    setEmbedder(new FakeEmbedder())

    const res = await postStream({ transcript: makeTranscript() }, headers)
    expect(res.status).toBe(200)
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1].type).toBe('recipe')
  })

  it('admin (∞) ignora o teto: streama mesmo com muitas gerações recentes', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'conv-admin@cap.test', role: 'admin' })
    await seedGenerationsForUser(userId, 50)
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens()))
    setEmbedder(new FakeEmbedder())

    const res = await postStream({ transcript: makeTranscript() }, headers)
    expect(res.status).toBe(200)
  })

  it('teto vem da CONFIG: usuario cap=1 ⇒ 2ª geração via chat estoura (429), não o default 10', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'conv-cfg@cap.test' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })
    await seedGenerationsForUser(userId, 1) // já no teto da config (1)
    setClaudeClient(new ExplodingClaudeClient())

    const res = await postStream({ transcript: makeTranscript() }, headers)
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: 'limite_geracao' })
  })
})

// Receita "miolo" válida do builder canned (success sempre carrega recipe não-null).
function cannedSuccessRecipe() {
  const out = cannedSuccess()
  if (out.kind !== 'object' || out.recipe === null) throw new Error('cannedSuccess sem recipe')
  return out.recipe
}
