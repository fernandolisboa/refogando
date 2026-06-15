import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { POST } from '@/app/api/generations/route'
import { GET as GET_SESSION } from '@/app/api/creation-sessions/[id]/route'
import { GET as GET_RECIPE } from '@/app/api/recipes/[id]/route'
import { getDb, setClaudeClient } from '@/server/deps'
import type { ClaudeClient } from '@/server/claude/client'
import { FakeClaudeClient } from '@/server/claude/client'
import {
  recipe,
  recipeTranslation,
  recipeIngredient,
  creationSession,
  generation,
  appConfig,
} from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedFeijoadaCatalog } from '../helpers/recipes'
import {
  cannedSuccess,
  cannedDegraded,
  cannedPlayful,
  cannedImpossible,
  cannedRefusal,
  cannedMaxTokens,
  cannedParseFailed,
  makeBriefing,
} from '../helpers/generation'

/**
 * Contrato da taxonomia de geração pela porta mais alta (issue #8, §8) — o handler
 * POST /api/generations + GET /api/creation-sessions/[id] contra o Postgres real, com
 * o seam do Claude trocado por `FakeClaudeClient(undefined, canned)`. `setup.ts` faz
 * `resetDeps()` + `truncateAll` antes de cada teste.
 *
 * Invariantes de banco (CHECK 23514, recipe_id NULL, contagens) via cliente RAW
 * postgres-js (`makeSql`) — só assim o PostgresError carrega `.code` no TOPO. PKs são
 * uuid não-determinístico: asserir sempre pelo id RETORNADO/headers.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** POST /api/generations com corpo JSON (+ headers de sessão opcionais). */
function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/generations', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/** GET /api/creation-sessions/[id] — `params` como Promise no 2º arg (rota dinâmica). */
function getSession(id: string, headers?: Headers): Promise<Response> {
  return GET_SESSION(new Request(`http://localhost/api/creation-sessions/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

/** GET /api/recipes/[id] — headers opcionais (anon = sem sessão); `params` como Promise. */
function getRecipe(id: string, headers?: Headers): Promise<Response> {
  return GET_RECIPE(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

/** Cliente que ESTOURA se o seam for tocado — prova que a validação curto-circuitou antes. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('ExplodingClaudeClient.echo não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: o input devia ter sido rejeitado ANTES da geração')
  }
}

/** Contagens cruas das três tabelas tocáveis (porta alta, sem ORM). */
async function counts(): Promise<{ recipe: number; session: number; generation: number }> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipe`
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
  const [g] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  return { recipe: r.n, session: s.n, generation: g.n }
}

describe('POST /api/generations — taxonomia de resultado', () => {
  it('SUCCESS (structured) → 201; recipe privada + provenance IA + advisory FORA da recipe', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ok@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { outcome: string; recipeId: string; advisory: string | null }
    expect(json.outcome).toBe('success')
    expect(json.recipeId).toBeTruthy()

    // Recipe: nasce privada, origin por mode (structured → ai_structured), result_kind
    // success, dono = caller. owner_id é o uuid RETORNADO por seedSessionHeaders.
    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, json.recipeId))
    expect(rec).toBeDefined()
    expect(rec.origin).toBe('ai_structured')
    expect(rec.visibility).toBe('private')
    expect(rec.resultKind).toBe('success')
    expect(rec.ownerId).toBe(userId)

    // Translation no locale original: provenance IA não revisada; titulo do fake.
    const [tr] = await db
      .select()
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, json.recipeId))
    expect(tr.locale).toBe('pt-BR')
    expect(tr.provenance).toBe('automatica_nao_revisada')
    expect(tr.titulo).toBe('Arroz de forno')

    // recipe_ingredient: quantidade é STRING (numeric(10,3)), nunca number.
    const ings = await db
      .select()
      .from(recipeIngredient)
      .where(eq(recipeIngredient.recipeId, json.recipeId))
      .orderBy(recipeIngredient.ordem)
    expect(ings.length).toBe(2)
    expect(typeof ings[0].quantidade).toBe('string')
    expect(ings[0].quantidade).toBe('2.000')
    expect(ings[1].quantidade).toBeNull()

    // generation: recipe_id setado, outcome success, advisory_comment NA GENERATION.
    const [gen] = await db.select().from(generation).where(eq(generation.recipeId, json.recipeId))
    expect(gen.recipeId).toBe(json.recipeId)
    expect(gen.outcome).toBe('success')
    expect(gen.advisoryComment).toBe('Dica: use arroz do dia anterior.')

    // O Comentário consultivo NÃO vive na Receita: nenhuma coluna de advisory em recipe.
    expect(rec).not.toHaveProperty('advisoryComment')
    expect(rec).not.toHaveProperty('advisory')

    // creation_session: ref FRACA session→recipe (recipe_id = a recipe).
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.recipeId).toBe(json.recipeId)
    expect(cs.mode).toBe('structured')
  })

  it('DEGRADED → 201; result_kind degraded, privada, advisory na generation', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'deg@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedDegraded({}, 'ajustei a receita')))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { outcome: string; recipeId: string }
    expect(json.outcome).toBe('degraded')

    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, json.recipeId))
    expect(rec.resultKind).toBe('degraded')
    expect(rec.visibility).toBe('private')
    expect(rec.ownerId).toBe(userId)

    const [gen] = await db.select().from(generation).where(eq(generation.recipeId, json.recipeId))
    expect(gen.outcome).toBe('degraded')
    expect(gen.advisoryComment).toBe('ajustei a receita')
  })

  it('PLAYFUL → 201; result_kind playful, SEMPRE privada', async () => {
    const { headers } = await seedSessionHeaders({ email: 'play@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedPlayful()))

    const res = await post({ mode: 'conversation' }, headers)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { outcome: string; recipeId: string }
    expect(json.outcome).toBe('playful')

    const db = getDb()
    const [rec] = await db.select().from(recipe).where(eq(recipe.id, json.recipeId))
    expect(rec.resultKind).toBe('playful')
    expect(rec.visibility).toBe('private')
  })

  it('invariante: playful + public viola CHECK recipe_playful_private_chk ⇒ 23514', async () => {
    // O CHECK é a garantia de banco que torna playful público IMPOSSÍVEL — mesmo se a
    // persistência regredisse. Inserção crua (SQL) para o PostgresError carregar .code.
    let err: unknown
    try {
      await sql`
        INSERT INTO recipe (origin, original_locale, result_kind, visibility)
        VALUES ('ai_chat', 'pt-BR', 'playful', 'public')
      `
    } catch (e) {
      err = e
    }
    expect((err as { code?: string }).code).toBe('23514')
  })

  it('IMPOSSIBLE → 200, sem recipe; creation_session + generation com recipe_id NULL', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'imp@gen.test' })
    setClaudeClient(
      new FakeClaudeClient(undefined, cannedImpossible('Não dá pra fazer bolo só com água.')),
    )

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { outcome: string; advisory: string | null }
    expect(json.outcome).toBe('impossible')
    expect(json.advisory).toBe('Não dá pra fazer bolo só com água.')

    // NENHUMA recipe — impossible é hard-stop honesto sem Receita.
    const c = await counts()
    expect(c.recipe).toBe(0)

    // Mas HÁ episódio de criação: creation_session + generation (recipe_id NULL).
    const db = getDb()
    const [cs] = await db.select().from(creationSession).where(eq(creationSession.userId, userId))
    expect(cs.recipeId).toBeNull()
    const [gen] = await db
      .select()
      .from(generation)
      .where(eq(generation.creationSessionId, cs.id))
    expect(gen.recipeId).toBeNull()
    expect(gen.outcome).toBe('impossible')
    expect(gen.advisoryComment).toBe('Não dá pra fazer bolo só com água.')
  })

  it('INVALID via refusal → 502; ZERO recipe + ZERO creation_session + ZERO generation', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ref@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedRefusal()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: 'geracao_invalida' })

    // invalid é erro de sistema puro: NÃO é episódio de criação → nada gravado.
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('INVALID via max_tokens → 502; nada persistido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'maxtok@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedMaxTokens()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(502)
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('INVALID via parse_failed → 502; nada persistido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'parse@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedParseFailed()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(502)
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('INVALID via faixa fora-de-faixa na saída do MODELO → 502; nada (não clampa)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'range@gen.test' })
    // modelKind success mas porcoes=99 (PORCOES max=50) → classify devolve invalid.
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess({ porcoes: 99 })))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(502)
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('origin por mode: conversation ⇒ ai_chat; structured ⇒ ai_structured', async () => {
    // conversation → ai_chat
    {
      const { headers } = await seedSessionHeaders({ email: 'conv@gen.test' })
      setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
      const res = await post({ mode: 'conversation' }, headers)
      expect(res.status).toBe(201)
      const { recipeId } = (await res.json()) as { recipeId: string }
      const [rec] = await getDb().select().from(recipe).where(eq(recipe.id, recipeId))
      expect(rec.origin).toBe('ai_chat')
    }
    // structured → ai_structured
    {
      const { headers } = await seedSessionHeaders({ email: 'struct@gen.test' })
      setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
      const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
      expect(res.status).toBe(201)
      const { recipeId } = (await res.json()) as { recipeId: string }
      const [rec] = await getDb().select().from(recipe).where(eq(recipe.id, recipeId))
      expect(rec.origin).toBe('ai_structured')
    }
  })

  it('uma linha de generation por tentativa: SUCCESS depois IMPOSSIBLE ⇒ 2 linhas', async () => {
    const { headers } = await seedSessionHeaders({ email: 'twoattempts@gen.test' })

    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    const ok = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(ok.status).toBe(201)

    setClaudeClient(new FakeClaudeClient(undefined, cannedImpossible()))
    const imp = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(imp.status).toBe(200)

    // 2 generations: uma com recipe_id setado (success), outra NULL (impossible).
    const [g] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
    expect(g.n).toBe(2)
    const [withRecipe] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM generation WHERE recipe_id IS NOT NULL
    `
    const [withoutRecipe] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM generation WHERE recipe_id IS NULL
    `
    expect(withRecipe.n).toBe(1)
    expect(withoutRecipe.n).toBe(1)
  })

  it('anon (sem headers) → 401; o fake NUNCA é chamado; nada criado', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'structured' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

    // Anônimo é efêmero/não-persistido: nenhuma linha em lugar nenhum.
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('input do usuário fora de faixa (porcoes) → 400 ANTES do seam (fake estoura se tocado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'badporcoes@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'conversation', porcoes: 999 }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'porcoes_fora_de_faixa' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('input do usuário fora de faixa (dificuldade) → 400 ANTES do seam', async () => {
    const { headers } = await seedSessionHeaders({ email: 'baddif@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'conversation', dificuldade: 99 }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dificuldade_fora_de_faixa' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('mode inválido → 400 modo_invalido (o seam não é tocado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'badmode@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ mode: 'telepatia' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'modo_invalido' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0 })
  })

  it('mode ausente → 400 modo_invalido', async () => {
    const { headers } = await seedSessionHeaders({ email: 'nomode@gen.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({}, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'modo_invalido' })
  })

  it('model resolvido de app_config: default_model presente ⇒ generation.model casa', async () => {
    await getDb().insert(appConfig).values({ id: true, defaultModel: 'claude-sonnet-4-6' })
    const { headers } = await seedSessionHeaders({ email: 'model@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    const { recipeId } = (await res.json()) as { recipeId: string }

    const [gen] = await getDb().select().from(generation).where(eq(generation.recipeId, recipeId))
    expect(gen.model).toBe('claude-sonnet-4-6')
  })

  it('model resolvido de app_config: linha ausente ⇒ default claude-opus-4-8', async () => {
    // Sem inserir app_config (truncado no beforeEach): cai no default em código.
    const { headers } = await seedSessionHeaders({ email: 'defmodel@gen.test' })
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))

    const res = await post({ mode: 'structured', briefing: makeBriefing() }, headers)
    expect(res.status).toBe(201)
    const { recipeId } = (await res.json()) as { recipeId: string }

    const [gen] = await getDb().select().from(generation).where(eq(generation.recipeId, recipeId))
    expect(gen.model).toBe('claude-opus-4-8')
  })
})

describe('GET /api/creation-sessions/[id] — retomada', () => {
  it('retoma Session cuja Receita tem schema_version mais antigo ⇒ 200 + view (sem erro/migração)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'resume@gen.test' })

    // Receita atual com schema_version 0 (mais antigo que SCHEMA_VERSION_RECEITA=1).
    const recipeId = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
      resultKind: 'success',
      porcoes: 4,
      dificuldade: 2,
      schemaVersion: 0,
    })
    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId, mode: 'conversation', recipeId })
      .returning({ id: creationSession.id })

    const res = await getSession(cs.id, headers)
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      recipe: { id: string; schemaVersion: number } | null
    }
    // A leitura NÃO ramifica por schema_version: devolve a Receita atual como está.
    expect(json.recipe).not.toBeNull()
    expect(json.recipe?.id).toBe(recipeId)
    expect(json.recipe?.schemaVersion).toBe(0)
  })

  it('IDOR: Session do user A → GET com sessão do user B ⇒ 404 (não vaza existência)', async () => {
    const { userId: aId } = await seedSessionHeaders({ email: 'idor-a@gen.test' })
    const { headers: bHeaders } = await seedSessionHeaders({ email: 'idor-b@gen.test' })

    const [cs] = await getDb()
      .insert(creationSession)
      .values({ userId: aId, mode: 'conversation', recipeId: null })
      .returning({ id: creationSession.id })

    const res = await getSession(cs.id, bHeaders)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('Session ausente (uuid bem-formado mas inexistente) ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'absent@gen.test' })

    const res = await getSession('00000000-0000-0000-0000-000000000000', headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('id malformado (não-uuid) ⇒ 404 (não 500/vazamento de SQL)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'malformed@gen.test' })

    const res = await getSession('not-a-uuid', headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })
})

describe('GET /api/recipes/[id] — gating de ownership/visibility (#8)', () => {
  it('Receita privada gerada pelo user A: anon ⇒ 404; user B ⇒ 404; o próprio user A ⇒ 200 + view', async () => {
    const { userId: aId, headers: aHeaders } = await seedSessionHeaders({ email: 'gate-a@gen.test' })
    const { headers: bHeaders } = await seedSessionHeaders({ email: 'gate-b@gen.test' })

    // Gera de verdade pela porta alta: Receita privada com dono = user A.
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    const genRes = await post({ mode: 'structured', briefing: makeBriefing() }, aHeaders)
    expect(genRes.status).toBe(201)
    const { recipeId } = (await genRes.json()) as { recipeId: string }

    // Confirma a invariante de partida: privada + dono = A.
    const [rec] = await getDb().select().from(recipe).where(eq(recipe.id, recipeId))
    expect(rec.visibility).toBe('private')
    expect(rec.ownerId).toBe(aId)

    // Anônimo (sem sessão) → 404 not_found (não 401/403 — não vaza existência).
    const anon = await getRecipe(recipeId)
    expect(anon.status).toBe(404)
    await expect(anon.json()).resolves.toMatchObject({ error: 'not_found' })

    // Outro Usuário (user B) → 404 (mesma forma, sem vazar existência).
    const other = await getRecipe(recipeId, bHeaders)
    expect(other.status).toBe(404)
    await expect(other.json()).resolves.toMatchObject({ error: 'not_found' })

    // O próprio dono (user A) → 200 + a view da sua Receita.
    const own = await getRecipe(recipeId, aHeaders)
    expect(own.status).toBe(200)
    const view = (await own.json()) as { id: string; visibility?: unknown }
    expect(view.id).toBe(recipeId)
  })

  it('Receita de catálogo (owner_id NULL) continua pública: anon ⇒ 200', async () => {
    const { recipeId } = await seedFeijoadaCatalog()

    const res = await getRecipe(recipeId)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { id: string; origin: string }
    expect(view.id).toBe(recipeId)
    expect(view.origin).toBe('catalog')
  })
})
