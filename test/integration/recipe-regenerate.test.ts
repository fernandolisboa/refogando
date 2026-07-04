import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient, setEmbedder } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import type { ClaudeClient } from '@/server/claude/client'
import { ThrowingEmbedder, type Embedder } from '@/server/embedding/embedder'
import {
  recipe,
  creationSession,
  generation,
  briefing as briefingTable,
  briefingItem,
  transcriptMessage,
  recipeEmbedding,
  appConfig,
} from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import type { RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { POST as regenerateRoute } from '@/app/api/recipes/[id]/regenerate/route'
import { DELETE as deleteRecipeRoute } from '@/app/api/recipes/[id]/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { cannedSuccess, cannedPlayful, cannedImpossible, cannedRefusal } from '../helpers/generation'
import type { Origin } from '@/domain/recipe'

/**
 * REGENERAÇÃO — nova versão IMUTÁVEL por linhagem (#20). Regenerar uma Receita PRÓPRIA cria uma
 * NOVA linha ligada à predecessora (lineage_kind='regenerated', parent_recipe_id), reusa a MESMA
 * creation_session (sem 2ª sessão), HERDA o origin, e o embedding da nova entra na Busca. O GATE
 * (owner+origin+fonte) é o 1º toque de DB, ANTES do Claude. Porta mais alta (handler POST);
 * FakeClaudeClient (sem rede) + FakeEmbedder (sem API real). Modelo: recipe-derive.test.ts.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// FakeEmbedder determinístico: devolve um vetor 1536-dim constante e CONTA chamadas (prova que o
// recompute da nova Receita disparou — entraria na Busca). NUNCA toca a API real.
class FakeEmbedder implements Embedder {
  public calls = 0
  async embed(): Promise<number[]> {
    this.calls++
    return new Array(EMBEDDING_DIMENSIONS).fill(0.1)
  }
}

// Seam que ESTOURA se generateRecipe for chamado — prova que o gate barra ANTES do Claude.
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('echo não devia ser chamado')
  }
  async generateRecipeVariants(): Promise<never> {
    throw new Error('generateRecipeVariants não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: o gate devia ter barrado ANTES da geração')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('streamConversation não devia ser chamado')
  }
  async extractIngredients(): Promise<never> {
    throw new Error('extractIngredients não devia ser chamado')
  }
}

function regenerate(id: string, headers?: Headers): Promise<Response> {
  return regenerateRoute(
    new Request(`http://localhost/api/recipes/${id}/regenerate`, { method: 'POST', headers }),
    { params: Promise.resolve({ id }) },
  )
}

function deleteRecipe(id: string, headers?: Headers): Promise<Response> {
  return deleteRecipeRoute(
    new Request(`http://localhost/api/recipes/${id}`, { method: 'DELETE', headers }),
    { params: Promise.resolve({ id }) },
  )
}

type RecipeState = {
  origin: string
  ownerId: string | null
  visibility: string
  resultKind: string
  parentRecipeId: string | null
  lineageKind: string | null
  derivedDiff: unknown
}

async function readState(id: string): Promise<RecipeState> {
  const [row] = await getDb()
    .select({
      origin: recipe.origin,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      parentRecipeId: recipe.parentRecipeId,
      lineageKind: recipe.lineageKind,
      derivedDiff: recipe.derivedDiff,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row as RecipeState
}

async function counts(): Promise<{ recipe: number; session: number; generation: number }> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipe`
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
  const [g] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  return { recipe: r.n, session: s.n, generation: g.n }
}

/**
 * Semeia uma Receita ai_* PRÓPRIA com a creation_session que a entregou (recipe_id apontando a
 * ela) + a fonte de prompt do modo pedido. Devolve { recipeId, sessionId }.
 *  - conversation → 3 transcript_message (user/assistant/user).
 *  - structured   → briefing + 1 briefing_item, sessão com briefing_id.
 *  - free_text    → sessão com free_text CRU.
 */
async function seedOwnAiRecipe(input: {
  ownerId: string
  mode: 'conversation' | 'structured' | 'free_text'
  origin: Origin
  resultKind?: 'success' | 'degraded' | 'playful'
}): Promise<{ recipeId: string; sessionId: string }> {
  const recipeId = await seedRecipe({
    origin: input.origin,
    originalLocale: 'pt-BR',
    visibility: 'private',
    resultKind: input.resultKind ?? 'success',
    ownerId: input.ownerId,
    cozinha: 'brasileira',
    porcoes: 4,
    dificuldade: 2,
  })
  await seedTranslation({
    recipeId,
    locale: 'pt-BR',
    titulo: 'Receita original',
    descricao: 'Versão original.',
    provenance: 'automatica_nao_revisada',
  })

  let briefingId: string | null = null
  let freeText: string | null = null
  if (input.mode === 'structured') {
    const [b] = await getDb()
      .insert(briefingTable)
      .values({ cozinha: 'brasileira', restricoes: ['sem_gluten'], porcoes: 4, dificuldade: 2 })
      .returning({ id: briefingTable.id })
    briefingId = b.id
    await getDb()
      .insert(briefingItem)
      .values({ briefingId, strength: 'required', rawText: 'arroz cozido', quantidade: '2.000', unidade: 'xicara', ordem: 0 })
  } else if (input.mode === 'free_text') {
    freeText = 'um arroz de forno cremoso com queijo, para quatro pessoas'
  }

  const [s] = await getDb()
    .insert(creationSession)
    .values({ userId: input.ownerId, mode: input.mode, recipeId, briefingId, freeText })
    .returning({ id: creationSession.id })
  const sessionId = s.id

  // generation original (uma por sessão; a regeneração ADICIONA outra na MESMA sessão).
  await getDb()
    .insert(generation)
    .values({ creationSessionId: sessionId, recipeId, outcome: input.resultKind ?? 'success', model: 'claude-opus-4-8', schemaVersion: 1 })

  if (input.mode === 'conversation') {
    await getDb()
      .insert(transcriptMessage)
      .values([
        { creationSessionId: sessionId, role: 'user', content: 'quero arroz de forno', seq: 0 },
        { creationSessionId: sessionId, role: 'assistant', content: 'com queijo?', seq: 1 },
        { creationSessionId: sessionId, role: 'user', content: 'sim, bem cremoso', seq: 2 },
      ])
  }

  return { recipeId, sessionId }
}

describe('POST /api/recipes/[id]/regenerate — REGENERAÇÃO por linhagem (#20)', () => {
  // (a) regenerar uma ai_chat PRÓPRIA com sessão recuperável ⇒ NOVA linha imutável.
  it('(a) regenera ai_chat própria ⇒ nova linha regenerated/parent=pred/origin herdado/diff NULL/private', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-chat@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    const before = await readState(recipeId)
    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; outcome: string; advisory: string | null }
    expect(body.outcome).toBe('success')
    expect(body.recipeId).not.toBe(recipeId)

    const novo = await readState(body.recipeId)
    expect(novo.lineageKind).toBe('regenerated')
    expect(novo.parentRecipeId).toBe(recipeId)
    expect(novo.origin).toBe('ai_chat') // HERDADO exato da predecessora
    expect(novo.derivedDiff).toBeNull() // regenerated NÃO carrega diff
    expect(novo.visibility).toBe('private')
    expect(novo.ownerId).toBe(userId)
    expect(novo.resultKind).toBe('success') // do classify FRESCO

    // A predecessora fica INTACTA (imutável; regeneração nunca sobrescreve).
    expect(await readState(recipeId)).toEqual(before)
  })

  // (#119) o embed da NOVA Receita é best-effort: embedder indisponível NÃO derruba a regeneração.
  it('(#119) embedder INDISPONÍVEL (Throwing) ⇒ regenerar ainda 201; a nova Receita persiste', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-embed-throw@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new ThrowingEmbedder()) // sem key / 429 — antes do #119 isto 500-ava a regeneração

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201) // a regeneração NÃO falha por causa do embedder (best-effort)
    const body = (await res.json()) as { recipeId: string }
    expect(body.recipeId).not.toBe(recipeId)
    expect((await readState(body.recipeId)).lineageKind).toBe('regenerated') // a nova Receita existe
  })

  // (b) a nova generation entra na MESMA creation_session (session count igual; generation +1).
  it('(b) nova generation na MESMA sessão: session count inalterado, generation +1', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-samesession2@ex.com' })
    const { recipeId, sessionId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    const before = await counts()
    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
    const after = await counts()
    expect(after.session).toBe(before.session) // NENHUMA 2ª sessão
    expect(after.generation).toBe(before.generation + 1) // +1 generation
    expect(after.recipe).toBe(before.recipe + 1) // +1 Receita (nova versão)

    // Ambas as generations penduradas na MESMA sessão.
    const gens = await getDb()
      .select({ id: generation.id })
      .from(generation)
      .where(eq(generation.creationSessionId, sessionId))
    expect(gens).toHaveLength(2)
  })

  // (c) structured rebuilds from briefing.
  it('(c) origin ai_structured ⇒ reconstrói do briefing ⇒ nova versão', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-structured@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'structured', origin: 'ai_structured' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string }
    expect((await readState(body.recipeId)).origin).toBe('ai_structured')
    expect((await readState(body.recipeId)).lineageKind).toBe('regenerated')
  })

  // (d) free_text rebuilds from creation_session.free_text.
  it('(d) origin ai_free_text ⇒ reconstrói do free_text ⇒ nova versão', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-freetext@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string }
    expect((await readState(body.recipeId)).origin).toBe('ai_free_text')
  })

  // (e) o embedding da NOVA Receita é recomputado (FakeEmbedder chamado) ⇒ entra na Busca.
  it('(e) embedding da nova Receita recomputado (FakeEmbedder invocado) ⇒ entra na Busca', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-embed@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    const embedder = new FakeEmbedder()
    setEmbedder(embedder)

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string }
    expect(embedder.calls).toBeGreaterThan(0)

    // Linha de embedding da NOVA Receita existe, não-stale (entraria na Busca).
    const [emb] = await getDb()
      .select({ stale: recipeEmbedding.stale, model: recipeEmbedding.model })
      .from(recipeEmbedding)
      .where(eq(recipeEmbedding.recipeId, body.recipeId))
    expect(emb).toBeDefined()
    expect(emb.stale).toBe(false)
  })

  // (f) Cadeia A→B→C: apagar B (DELETE de #21) SET-NULLs C.parent_recipe_id; A e C intactos.
  it('(f) cadeia A→B→C: apagar B set-null em C.parent_recipe_id; A e C sobrevivem (47/289)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-chain@ex.com' })
    const { recipeId: A } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    // A → B
    const resB = await regenerate(A, headers)
    const B = ((await resB.json()) as { recipeId: string }).recipeId
    // B → C
    const resC = await regenerate(B, headers)
    const C = ((await resC.json()) as { recipeId: string }).recipeId
    expect((await readState(C)).parentRecipeId).toBe(B)

    // Apaga B (DELETE /api/recipes/[id], #21).
    const del = await deleteRecipe(B, headers)
    expect(del.status).toBe(204)

    // A intacta; C sobrevive com parent_recipe_id ANULADO (set null), não apagado.
    expect(await readState(A)).toBeDefined()
    const stateC = await readState(C)
    expect(stateC.parentRecipeId).toBeNull()
    expect(stateC.lineageKind).toBe('regenerated') // a versão em si sobrevive intacta
  })

  // (g) playful ⇒ result_kind playful, visibility forçada private (CHECK).
  it('(g) regeneração playful ⇒ result_kind playful + private (CHECK satisfeito)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-playful@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedPlayful()))
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; outcome: string }
    expect(body.outcome).toBe('playful')
    const novo = await readState(body.recipeId)
    expect(novo.resultKind).toBe('playful')
    expect(novo.visibility).toBe('private')
  })

  // (h) derivada (user_edited) ⇒ 409 sem_fonte (sem sessão/briefing/transcrição).
  it('(h) regenerar user_edited (derivada) ⇒ 409 sem_fonte_para_regenerar; nenhuma nova linha', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-edited@ex.com' })
    const baseId = await seedRecipe({
      origin: 'user_edited',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
      lineageKind: 'edited',
    })
    await seedTranslation({ recipeId: baseId, locale: 'pt-BR', titulo: 'Derivada', provenance: 'escrita_por_pessoa' })
    setClaudeClient(new ExplodingClaudeClient()) // gate barra ANTES do Claude
    setEmbedder(new FakeEmbedder())

    const before = await counts()
    const res = await regenerate(baseId, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'sem_fonte_para_regenerar' })
    expect((await counts()).recipe).toBe(before.recipe)
  })

  // (i) catálogo ⇒ 404 (não-própria), ANTES do Claude.
  it('(i) regenerar receita de catálogo ⇒ 404 not_found (não é própria); Claude não tocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'regen-catalog@ex.com' })
    const catId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: catId, locale: 'pt-BR', titulo: 'Catálogo', provenance: 'escrita_por_pessoa' })
    setClaudeClient(new ExplodingClaudeClient())
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(catId, headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  // (j) conversa com transcrição APAGADA ⇒ 409 sem_fonte (não 500).
  it('(j) conversation com transcrição apagada ⇒ 409 sem_fonte (não 500)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-deleted-transcript@ex.com' })
    const { recipeId, sessionId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    // Apaga a transcrição (espelha DELETE /transcript de #15).
    await getDb().delete(transcriptMessage).where(eq(transcriptMessage.creationSessionId, sessionId))
    setClaudeClient(new ExplodingClaudeClient()) // sem fonte → gate barra antes do Claude
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'sem_fonte_para_regenerar' })
  })

  // (k) gate de posse ANTES do Claude: NÃO-dono ⇒ ZERO chamadas ao modelo.
  it('(k) não-dono regenera ⇒ 404 e ZERO chamada ao Claude (ExplodingClaudeClient não estoura)', async () => {
    const { userId: ownerA } = await seedSessionHeaders({ email: 'regen-ownerA@ex.com' })
    const { headers: headersB } = await seedSessionHeaders({ email: 'regen-viewerB@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: ownerA, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new ExplodingClaudeClient()) // se tocado, estoura → teste vermelho
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headersB)
    expect(res.status).toBe(404) // leak-safe (NUNCA 403)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  // (l) outcome impossible ⇒ 200 sem Receita.
  it('(l) classify impossible ⇒ 200 sem recipe (episódio persistido, sem nova Receita)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-impossible@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedImpossible()))
    setEmbedder(new FakeEmbedder())

    const before = await counts()
    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { outcome: string; recipeId?: string }
    expect(body.outcome).toBe('impossible')
    expect(body.recipeId).toBeUndefined()
    const after = await counts()
    expect(after.recipe).toBe(before.recipe) // NENHUMA nova Receita
    expect(after.generation).toBe(before.generation + 1) // mas o episódio (generation) persiste
  })

  // (m) outcome invalid (refusal) ⇒ 502, NADA persiste.
  it('(m) classify invalid (refusal) ⇒ 502 geracao_invalida; NADA persiste', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-invalid@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedRefusal()))
    setEmbedder(new FakeEmbedder())

    const before = await counts()
    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ outcome: 'invalid', error: 'geracao_invalida' })
    const after = await counts()
    expect(after).toEqual(before) // NADA persiste (recipe/session/generation inalterados)
  })

  // (n) Visitante (sem sessão) ⇒ 401; ZERO efeito colateral.
  it('(n) Visitante (sem sessão) ⇒ 401; nenhuma nova linha', async () => {
    const { userId } = await seedSessionHeaders({ email: 'regen-visitante@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'free_text', origin: 'ai_free_text' })
    setClaudeClient(new ExplodingClaudeClient())
    setEmbedder(new FakeEmbedder())

    const before = await counts()
    const res = await regenerate(recipeId) // sem headers
    expect(res.status).toBe(401)
    expect(await counts()).toEqual(before)
  })

  // (o) id malformado ⇒ 404 (sem 500, curto-circuito isUuid); uuid inexistente ⇒ 404.
  it('(o) id não-uuid ⇒ 404 sem 500; uuid inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'regen-badid@ex.com' })
    setClaudeClient(new ExplodingClaudeClient())
    const bad = await regenerate('not-a-uuid', headers)
    expect(bad.status).toBe(404)
    const missing = await regenerate('00000000-0000-0000-0000-000000000000', headers)
    expect(missing.status).toBe(404)
  })

  // ── TETO de geração por papel (#167) NO BOTÃO DE REGENERAR ────────────────────────────────────
  // A brecha que o gate de /api/generations sozinho deixava: regenerar (#20) também faz a chamada
  // PAGA generateRecipe e persiste uma `generation` que CONTA pro teto. Sem o gate aqui, um usuário
  // que estoura o teto continuava gerando pelo botão de regenerar.
  it('(p) teto estourado (usuario default 10) ⇒ regenerar dá 429 limite_geracao; o Claude NÃO é tocado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-cap@ex.com' })
    // seedOwnAiRecipe já cria 1 generation; semeia +9 (própria sessão) ⇒ 10 = teto default do usuario.
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    await seedExtraGenerations(userId, 9)
    setClaudeClient(new ExplodingClaudeClient()) // estoura se o teto NÃO barrar antes do Claude
    const before = await counts()

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_geracao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
    // Nenhuma Receita/generation nova nasceu (barrado ANTES de persistir).
    expect(await counts()).toEqual(before)
  })

  it('(q) abaixo do teto (usuario, 9 gerações) ⇒ regenerar segue normal (201, nova versão)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-cap-below@ex.com' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    await seedExtraGenerations(userId, 8) // 1 (semente) + 8 = 9 < 10
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
  })

  it('(r) admin (∞) ignora o teto: regenera mesmo com muitas gerações recentes', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-cap-admin@ex.com', role: 'admin' })
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    await seedExtraGenerations(userId, 50)
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setEmbedder(new FakeEmbedder())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(201)
  })

  it('(s) teto da CONFIG: usuario cap=1 ⇒ regenerar (já com 1 geração) estoura 429', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-cap-cfg@ex.com' })
    await setRecipeGenCap({ usuario: 1, curador: 20, admin: null })
    // seedOwnAiRecipe já cria 1 generation ⇒ no teto da config (1).
    const { recipeId } = await seedOwnAiRecipe({ ownerId: userId, mode: 'conversation', origin: 'ai_chat' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await regenerate(recipeId, headers)
    expect(res.status).toBe(429)
    await expect(res.json()).resolves.toMatchObject({ error: 'limite_geracao' })
  })
})

/** Semeia N gerações EXTRA do usuário (além da semente do seedOwnAiRecipe) numa sessão própria. */
async function seedExtraGenerations(userId: string, n: number): Promise<void> {
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
