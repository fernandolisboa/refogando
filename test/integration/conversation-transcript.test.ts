import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq, asc } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import type { ClaudeClient } from '@/server/claude/client'
import type { GenerationOutput } from '@/domain/generation'
import { POST as POST_CREATE } from '@/app/api/creation-sessions/route'
import { GET as GET_SESSION } from '@/app/api/creation-sessions/[id]/route'
import { DELETE as DELETE_TRANSCRIPT } from '@/app/api/creation-sessions/[id]/transcript/route'
import {
  recipe,
  recipeTranslation,
  recipeIngredient,
  creationSession,
  generation,
  transcriptMessage,
} from '@/db/schema'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe } from '../helpers/recipes'
import { cannedSuccess, cannedDegraded, cannedImpossible } from '../helpers/generation'
import { makeTranscript, cannedTokens, postStream, collectNdjson } from '../helpers/conversation'

/**
 * Transcrição durável da conversa (#15) pela porta mais alta, contra o Postgres real:
 *  - POST /api/creation-sessions cria a Session no COMEÇO (mode='conversation', recipe_id NULL).
 *  - POST /api/conversations/stream anexa 2 falas por chamada (seq monotônico), retomando a
 *    Session quando `sessionId` é enviado (sem double-store dos turnos anteriores).
 *  - GET /api/creation-sessions/[id] devolve {session, recipe, transcript, advisory}.
 *  - DELETE /api/creation-sessions/[id]/transcript apaga as falas E zera o advisory de TODAS as
 *    generation da Session, MANTENDO a Receita (result_kind/outcome/model intactos). Idempotente.
 *
 * `setup.ts` faz `resetDeps()` + `truncateAll` antes de cada teste. PKs são uuid não-
 * determinístico → sempre asserir pelo id RETORNADO/header.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** POST /api/creation-sessions (headers de sessão opcionais). */
function createSession(headers?: Headers): Promise<Response> {
  return POST_CREATE(
    new Request('http://localhost/api/creation-sessions', { method: 'POST', headers }),
  )
}

/** GET /api/creation-sessions/[id] — params como Promise (rota dinâmica). */
function getSession(id: string, headers?: Headers): Promise<Response> {
  return GET_SESSION(new Request(`http://localhost/api/creation-sessions/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

/** DELETE /api/creation-sessions/[id]/transcript — params como Promise. */
function deleteTranscript(id: string, headers?: Headers): Promise<Response> {
  return DELETE_TRANSCRIPT(
    new Request(`http://localhost/api/creation-sessions/${id}/transcript`, {
      method: 'DELETE',
      headers,
    }),
    { params: Promise.resolve({ id }) },
  )
}

type ResumeBody = {
  session: { id: string; mode: string; recipeId: string | null }
  recipe: { id: string } | null
  transcript: { role: string; content: string; seq: number }[]
  advisory: string | null
}

describe('POST /api/creation-sessions — início da Session', () => {
  it('cria creation_session(mode=conversation, recipe_id NULL) e devolve {sessionId}', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cs-create@conv.test' })

    const res = await createSession(headers)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    expect(sessionId).toBeTruthy()

    const [cs] = await getDb().select().from(creationSession).where(eq(creationSession.id, sessionId))
    expect(cs.userId).toBe(userId)
    expect(cs.mode).toBe('conversation')
    expect(cs.recipeId).toBeNull()
  })

  it('401 fail-closed sem sessão (anônimo)', async () => {
    const res = await createSession()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
    expect(n).toBe(0)
  })
})

describe('Per-turn append — seq monotônico, sem double-store entre chamadas', () => {
  it('duas chamadas na MESMA Session → seq 0,1,2,3 (user,assistant,user,assistant); updated_at bumpa', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-append@conv.test' })

    // Inicia a Session explicitamente (fluxo do começo da conversa).
    const created = await createSession(headers)
    const { sessionId } = (await created.json()) as { sessionId: string }
    const [before] = await getDb().select().from(creationSession).where(eq(creationSession.id, sessionId))

    // 1ª chamada: 1 turno do usuário → grava user(seq0) + assistant(seq1).
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['oi ', 'tudo bem'])))
    const r1 = await postStream(
      { sessionId, transcript: [{ role: 'user', content: 'quero arroz' }] },
      headers,
    )
    expect((await collectNdjson(r1)).at(-1)?.type).toBe('recipe')

    // 2ª chamada: o cliente reenvia a Transcrição COMPLETA terminando num novo turno do usuário.
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['claro ', 'já vai'])))
    const r2 = await postStream(
      {
        sessionId,
        transcript: [
          { role: 'user', content: 'quero arroz' },
          { role: 'assistant', content: 'oi tudo bem' },
          { role: 'user', content: 'com queijo' },
        ],
      },
      headers,
    )
    expect((await collectNdjson(r2)).at(-1)?.type).toBe('recipe')

    // EXATAMENTE 4 falas, seq contíguo 0..3, sem re-gravar os turnos anteriores.
    const msgs = await getDb()
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, sessionId))
      .orderBy(asc(transcriptMessage.seq))
    expect(msgs.map((m) => ({ role: m.role, content: m.content, seq: m.seq }))).toEqual([
      { role: 'user', content: 'quero arroz', seq: 0 },
      { role: 'assistant', content: 'oi tudo bem', seq: 1 },
      { role: 'user', content: 'com queijo', seq: 2 },
      { role: 'assistant', content: 'claro já vai', seq: 3 },
    ])

    // updated_at avançou (last-activity p/ TTL futuro — ADR-0006).
    const [after] = await getDb().select().from(creationSession).where(eq(creationSession.id, sessionId))
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())

    // UMA Session (UPDATE da Receita por destilação, nunca 2ª INSERT).
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
    expect(n).toBe(1)
  })
})

describe('Resume — GET devolve transcript + Receita + advisory', () => {
  it('após vários turnos: transcript ordenado por seq + Receita atual + advisory da última generation', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-resume@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    setClaudeClient(
      new FakeClaudeClient(undefined, cannedSuccess({}, 'dica final'), cannedTokens(['resposta'])),
    )
    await collectNdjson(
      await postStream({ sessionId, transcript: [{ role: 'user', content: 'arroz' }] }, headers),
    )

    const res = await getSession(sessionId, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ResumeBody
    expect(body.transcript).toEqual([
      { role: 'user', content: 'arroz', seq: 0 },
      { role: 'assistant', content: 'resposta', seq: 1 },
    ])
    expect(body.recipe).not.toBeNull()
    expect(body.session.recipeId).toBe(body.recipe!.id)
    expect(body.advisory).toBe('dica final')
  })

  it('antes da 1ª destilação (Session só criada) → transcript [] + recipe null + advisory null', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-resume-empty@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    const body = (await (await getSession(sessionId, headers)).json()) as ResumeBody
    expect(body.transcript).toEqual([])
    expect(body.recipe).toBeNull()
    expect(body.advisory).toBeNull()
  })
})

describe('Save-while-logged-in — Receita E Transcrição persistem', () => {
  it('destilação anexa a Receita (UPDATE recipe_id) e as falas permanecem', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-save@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['ok'])))
    const frames = await collectNdjson(
      await postStream({ sessionId, transcript: makeTranscript() }, headers),
    )
    const terminal = frames.at(-1)!
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')

    const [cs] = await getDb().select().from(creationSession).where(eq(creationSession.id, sessionId))
    expect(cs.recipeId).toBe(terminal.recipeId)
    const msgs = await getDb()
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, sessionId))
    expect(msgs.length).toBe(2)
  })
})

describe('DELETE transcript — apaga falas + zera advisory, MANTÉM a Receita', () => {
  it('Receita byte-idêntica (result_kind/outcome/model intactos); advisory NULL em TODA generation; falas sumiram', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-del@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    setClaudeClient(
      new FakeClaudeClient(undefined, cannedDegraded({}, 'comentário consultivo'), cannedTokens(['x'])),
    )
    const frames = await collectNdjson(
      await postStream({ sessionId, transcript: makeTranscript() }, headers),
    )
    const terminal = frames.at(-1)!
    if (terminal.type !== 'recipe') throw new Error('terminal não é recipe')
    const recipeId = terminal.recipeId!

    // Snapshot da Receita + linhas filhas ANTES do delete.
    const db = getDb()
    const [recBefore] = await db.select().from(recipe).where(eq(recipe.id, recipeId))
    const [trBefore] = await db.select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, recipeId))
    const ingsBefore = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId))
    const [genBefore] = await db.select().from(generation).where(eq(generation.recipeId, recipeId))
    expect(genBefore.advisoryComment).toBe('comentário consultivo')

    const del = await deleteTranscript(sessionId, headers)
    expect(del.status).toBe(200)

    // Receita BYTE-IDÊNTICA (incl. result_kind degraded); translation/ingredientes intactos.
    const [recAfter] = await db.select().from(recipe).where(eq(recipe.id, recipeId))
    expect(recAfter).toEqual(recBefore)
    expect(recAfter.resultKind).toBe('degraded')
    const [trAfter] = await db.select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, recipeId))
    expect(trAfter).toEqual(trBefore)
    const ingsAfter = await db.select().from(recipeIngredient).where(eq(recipeIngredient.recipeId, recipeId))
    expect(ingsAfter).toEqual(ingsBefore)

    // generation: outcome/model intactos, advisory_comment NULL.
    const [genAfter] = await db.select().from(generation).where(eq(generation.recipeId, recipeId))
    expect(genAfter.outcome).toBe(genBefore.outcome)
    expect(genAfter.model).toBe(genBefore.model)
    expect(genAfter.advisoryComment).toBeNull()

    // Falas sumiram.
    const msgs = await db.select().from(transcriptMessage).where(eq(transcriptMessage.creationSessionId, sessionId))
    expect(msgs.length).toBe(0)
  })

  it('idempotente: 2º DELETE → mesmo status 200, sem mudança', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-del-idem@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['x'])))
    await collectNdjson(await postStream({ sessionId, transcript: makeTranscript() }, headers))

    expect((await deleteTranscript(sessionId, headers)).status).toBe(200)
    expect((await deleteTranscript(sessionId, headers)).status).toBe(200)
    const msgs = await getDb()
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, sessionId))
    expect(msgs.length).toBe(0)
  })

  it('escopo: deletar a Session A não toca a Session B', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-scope@conv.test' })
    const idA = (await (await createSession(headers)).json() as { sessionId: string }).sessionId
    const idB = (await (await createSession(headers)).json() as { sessionId: string }).sessionId

    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess(), cannedTokens(['a'])))
    await collectNdjson(await postStream({ sessionId: idA, transcript: makeTranscript() }, headers))
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({}, 'advisory B'), cannedTokens(['b'])))
    await collectNdjson(await postStream({ sessionId: idB, transcript: makeTranscript() }, headers))

    expect((await deleteTranscript(idA, headers)).status).toBe(200)

    // B intacta: falas presentes e advisory preservado.
    const msgsB = await getDb()
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, idB))
    expect(msgsB.length).toBe(2)
    const [genB] = await getDb().select().from(generation).where(eq(generation.creationSessionId, idB))
    expect(genB.advisoryComment).toBe('advisory B')
  })

  it('múltiplas generation na Session (re-destilação) → DELETE zera advisory em TODAS (set-based)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-multigen@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({}, 'dica 1'), cannedTokens(['t1'])))
    await collectNdjson(await postStream({ sessionId, transcript: makeTranscript() }, headers))
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({}, 'dica 2'), cannedTokens(['t2'])))
    await collectNdjson(
      await postStream(
        {
          sessionId,
          transcript: [
            { role: 'user', content: 'arroz' },
            { role: 'assistant', content: 't1' },
            { role: 'user', content: 'de novo' },
          ],
        },
        headers,
      ),
    )

    // DUAS generation na MESMA Session.
    const gensBefore = await getDb().select().from(generation).where(eq(generation.creationSessionId, sessionId))
    expect(gensBefore.length).toBe(2)
    expect(gensBefore.every((g) => g.advisoryComment != null)).toBe(true)

    expect((await deleteTranscript(sessionId, headers)).status).toBe(200)

    const gensAfter = await getDb().select().from(generation).where(eq(generation.creationSessionId, sessionId))
    expect(gensAfter.length).toBe(2)
    expect(gensAfter.every((g) => g.advisoryComment === null)).toBe(true)
  })

  it('IDOR: DELETE de Session alheia → 404 (não vaza existência); não apaga nada', async () => {
    const { userId: aId } = await seedSessionHeaders({ email: 'cs-idor-a@conv.test' })
    const { headers: bHeaders } = await seedSessionHeaders({ email: 'cs-idor-b@conv.test' })

    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId: aId, mode: 'conversation', recipeId: null })
      .returning({ id: creationSession.id })
    await getDb().insert(transcriptMessage).values({
      creationSessionId: cs.id,
      role: 'user',
      content: 'segredo de A',
      seq: 0,
    })

    const res = await deleteTranscript(cs.id, bHeaders)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })

    // As falas de A continuam lá.
    const msgs = await getDb().select().from(transcriptMessage).where(eq(transcriptMessage.creationSessionId, cs.id))
    expect(msgs.length).toBe(1)
  })

  it('DELETE com id malformado (não-uuid) → 404 (sem 500)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-del-bad@conv.test' })
    const res = await deleteTranscript('not-a-uuid', headers)
    expect(res.status).toBe(404)
  })

  it('401 fail-closed sem sessão', async () => {
    const { userId } = await seedSessionHeaders({ email: 'cs-del-anon@conv.test' })
    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId, mode: 'conversation', recipeId: null })
      .returning({ id: creationSession.id })
    const res = await deleteTranscript(cs.id)
    expect(res.status).toBe(401)
  })
})

describe('Contratos de ON DELETE (FK)', () => {
  it('(a) DELETE creation_session → transcript_message cascateia E a Receita sobrevive', async () => {
    const { userId } = await seedSessionHeaders({ email: 'cs-cascade@conv.test' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
      resultKind: 'success',
    })
    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId, mode: 'conversation', recipeId })
      .returning({ id: creationSession.id })
    await getDb().insert(transcriptMessage).values([
      { creationSessionId: cs.id, role: 'user', content: 'a', seq: 0 },
      { creationSessionId: cs.id, role: 'assistant', content: 'b', seq: 1 },
    ])

    await getDb().delete(creationSession).where(eq(creationSession.id, cs.id))

    // transcript_message cascateou.
    const msgs = await getDb().select().from(transcriptMessage).where(eq(transcriptMessage.creationSessionId, cs.id))
    expect(msgs.length).toBe(0)
    // Receita sobrevive (ref FRACA session→recipe).
    const [rec] = await getDb().select().from(recipe).where(eq(recipe.id, recipeId))
    expect(rec).toBeDefined()
  })

  it('(b) DELETE recipe → creation_session.recipe_id e generation.recipe_id viram NULL; falas sobrevivem', async () => {
    const userId = await seedUser({ email: 'cs-setnull@conv.test' })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
      resultKind: 'success',
    })
    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId, mode: 'conversation', recipeId })
      .returning({ id: creationSession.id })
    await getDb().insert(generation).values({
      creationSessionId: cs.id,
      recipeId,
      outcome: 'success',
      advisoryComment: 'x',
      model: 'claude-opus-4-8',
      schemaVersion: 1,
    })
    await getDb().insert(transcriptMessage).values({
      creationSessionId: cs.id,
      role: 'user',
      content: 'fala',
      seq: 0,
    })

    await getDb().delete(recipe).where(eq(recipe.id, recipeId))

    const [csAfter] = await getDb().select().from(creationSession).where(eq(creationSession.id, cs.id))
    expect(csAfter.recipeId).toBeNull()
    const [genAfter] = await getDb().select().from(generation).where(eq(generation.creationSessionId, cs.id))
    expect(genAfter.recipeId).toBeNull()
    // Falas sobrevivem (presas à Session, não à Receita).
    const msgs = await getDb().select().from(transcriptMessage).where(eq(transcriptMessage.creationSessionId, cs.id))
    expect(msgs.length).toBe(1)
  })
})

describe('Concorrência de seq — UNIQUE(creation_session_id, seq) é a rede (23505)', () => {
  it('DB-level: INSERT cru duplicado em (creation_session_id, seq) ⇒ PostgresError 23505', async () => {
    // Prova determinística do backstop: duas falas concorrentes na MESMA Session que
    // calculassem o mesmo `seq` baterem no índice UNIQUE → 23505 (o que a rota traduz no
    // frame {type:'error',error:'conflito_concorrente'}). Aqui exercitamos só o índice, cru.
    const { userId } = await seedSessionHeaders({ email: 'cs-seqdup@conv.test' })
    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId, mode: 'conversation', recipeId: null })
      .returning({ id: creationSession.id })

    await sql`INSERT INTO transcript_message (creation_session_id, role, content, seq)
             VALUES (${cs.id}, 'user', 'primeira', 0)`
    let err: unknown
    try {
      await sql`INSERT INTO transcript_message (creation_session_id, role, content, seq)
               VALUES (${cs.id}, 'assistant', 'colisão no mesmo seq', 0)`
    } catch (e) {
      err = e
    }
    expect((err as { code?: string }).code).toBe('23505')

    // A 1ª fala sobreviveu; a colisão foi rejeitada (nada de duplicata).
    const msgs = await getDb()
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, cs.id))
    expect(msgs.length).toBe(1)
  })

  it('route-level: corrida de append na MESMA Session → o perdedor emite {type:error,conflito_concorrente} (nunca close mudo)', async () => {
    // Determinístico via BARREIRA: a colisão de seq só ocorre quando duas tx leem o MESMO max
    // antes de qualquer INSERT commitar. Um probe ClaudeClient prende as DUAS chamadas até
    // ambas terem aberto o stream; só então ambas seguem para o append (que lê max=−1 → next=0)
    // e UMA perde no UNIQUE(creation_session_id, seq) → 23505 → frame conflito_concorrente.
    const { headers } = await seedSessionHeaders({ email: 'cs-seqcollide@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    // Barreira de 2 participantes: cada streamConversation rende 1 token, sinaliza chegada e
    // espera o par antes de COMPLETAR (o append da rota roda só após o iterável terminar).
    let arrived = 0
    let releaseBoth!: () => void
    const bothArrived = new Promise<void>((r) => {
      releaseBoth = r
    })
    class BarrierClient implements ClaudeClient {
      async echo(t: string): Promise<string> {
        return t
      }
      async generateRecipe(): Promise<GenerationOutput> {
        return cannedSuccess()
      }
      async generateRecipeVariants(): Promise<GenerationOutput[]> {
        throw new Error('generateRecipeVariants não devia ser chamado')
      }
      async *streamConversation(): AsyncIterable<string> {
        yield 'tok'
        if (++arrived === 2) releaseBoth()
        await bothArrived // ambas só completam (→ append) quando as duas chegaram.
      }
      async extractIngredients(): Promise<{ kind: 'parse_failed' }> {
        return { kind: 'parse_failed' }
      }
    }
    setClaudeClient(new BarrierClient())

    // Duas chamadas concorrentes à MESMA Session: ambas leem max=−1 (next=0) antes de commitar.
    const [r1, r2] = await Promise.all([
      collectNdjson(await postStream({ sessionId, transcript: makeTranscript() }, headers)),
      collectNdjson(await postStream({ sessionId, transcript: makeTranscript() }, headers)),
    ])

    const terminals = [r1.at(-1)!, r2.at(-1)!]
    // NUNCA close mudo: ambas têm frame terminal. Uma venceu (recipe), a outra perdeu o seq e
    // recebeu o frame LIMPO conflito_concorrente (em vez de stream sem terminal).
    const conflicts = terminals.filter(
      (t) => t.type === 'error' && t.error === 'conflito_concorrente',
    )
    const recipes = terminals.filter((t) => t.type === 'recipe')
    expect(conflicts.length).toBe(1)
    expect(recipes.length).toBe(1)

    // A vencedora gravou EXATAMENTE 2 falas (seq 0,1); a perdedora reverteu (tx atômica).
    const msgs = await getDb()
      .select()
      .from(transcriptMessage)
      .where(eq(transcriptMessage.creationSessionId, sessionId))
    expect(msgs.length).toBe(2)
  })
})

describe('Transcrição longa — permanece ordenada e devolvida por inteiro', () => {
  it('muitos turnos → seq contíguo, GET devolve tudo em ordem', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cs-long@conv.test' })
    const { sessionId } = (await (await createSession(headers)).json()) as { sessionId: string }

    const turns = 8
    const transcript: { role: 'user' | 'assistant'; content: string }[] = []
    for (let i = 0; i < turns; i++) {
      transcript.push({ role: 'user', content: `u${i}` })
      setClaudeClient(new FakeClaudeClient(undefined, cannedImpossible('segue'), cannedTokens([`a${i}`])))
      await collectNdjson(await postStream({ sessionId, transcript: [...transcript] }, headers))
      transcript.push({ role: 'assistant', content: `a${i}` })
    }

    const body = (await (await getSession(sessionId, headers)).json()) as ResumeBody
    expect(body.transcript.length).toBe(turns * 2)
    // seq contíguo 0..(2*turns-1), em ordem.
    expect(body.transcript.map((m) => m.seq)).toEqual(
      Array.from({ length: turns * 2 }, (_, i) => i),
    )
    expect(body.transcript[0]).toEqual({ role: 'user', content: 'u0', seq: 0 })
    expect(body.transcript.at(-1)).toEqual({ role: 'assistant', content: `a${turns - 1}`, seq: turns * 2 - 1 })
  })
})
