import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { setClaudeClient } from '@/server/deps'
import type { ClaudeClient } from '@/server/claude/client'

import { GET as SEARCH } from '@/app/api/search/route'
import { GET as GET_RECIPE, PATCH as PATCH_RECIPE, DELETE as DELETE_RECIPE } from '@/app/api/recipes/[id]/route'
import { POST as GENERATIONS } from '@/app/api/generations/route'
import { POST as STREAM } from '@/app/api/conversations/stream/route'
import { POST as CREATION_SESSIONS } from '@/app/api/creation-sessions/route'
import { POST as DERIVE } from '@/app/api/recipes/[id]/derive/route'
import { POST as REGENERATE } from '@/app/api/recipes/[id]/regenerate/route'
import { POST as VOTE } from '@/app/api/recipes/[id]/vote/route'
import { POST as SAVE } from '@/app/api/recipes/[id]/save/route'
import { POST as PUBLISH } from '@/app/api/recipes/[id]/publish/route'
import { POST as REPORT } from '@/app/api/recipes/[id]/report/route'

import { seedUser } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedFeijoadaCatalog,
  seedSearchMatrix,
  seedRemovedFromPool,
} from '../helpers/recipes'
import { makeBriefing } from '../helpers/generation'
import { makeTranscript } from '../helpers/conversation'

/**
 * Contrato de ACESSO ANÔNIMO (issue #22, ADR-0011) pela porta MAIS ALTA — Postgres real,
 * Visitante = SEM headers de sessão. Trava a decisão DESCOPADA do owner: o Anônimo é
 * READ-ONLY; NÃO existe geração anônima, NÃO existe estado efêmero no servidor, NÃO existe
 * rota de claim/persist-on-signup. Toda ESCRITA e toda GERAÇÃO são *fail-closed* → 401, com
 * ZERO linhas persistidas e o seam do Claude NUNCA tocado (curto-circuito ANTES do seam).
 *
 * Sem produção nova: o contrato JÁ vale no código (todas as rotas de escrita/geração chamam
 * `requireSession`). Este arquivo LOCKA a garantia. `setup.ts` faz `resetDeps()` +
 * `truncateAll` antes de cada teste. PKs são uuid não-determinístico: asserir por id RETORNADO.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/**
 * Cliente que ESTOURA se o seam for tocado — prova que o 401 curto-circuita ANTES de
 * qualquer chamada ao LLM (espelha o ExplodingClaudeClient de generation/conversation-stream).
 */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('ExplodingClaudeClient.echo não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: o anônimo devia ter sido cortado (401) ANTES da geração')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('seam tocado: o anônimo devia ter sido cortado (401) ANTES do stream')
  }
  async extractIngredients(): Promise<never> {
    throw new Error('seam tocado: o anônimo devia ter sido cortado (401) ANTES da extração')
  }
}

/** Contagens cruas das tabelas tocáveis por escrita/geração (porta alta, sem ORM). */
async function counts(): Promise<{
  recipe: number
  session: number
  generation: number
  transcript: number
}> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipe`
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
  const [g] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  const [t] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM transcript_message`
  return { recipe: r.n, session: s.n, generation: g.n, transcript: t.n }
}

// ── Invocadores ANÔNIMOS (sem headers = Visitante) ────────────────────────────────

function search(q: string, locale = 'pt-BR'): Promise<Response> {
  const params = new URLSearchParams({ q, locale })
  return SEARCH(new Request(`http://localhost/api/search?${params.toString()}`))
}

/** GET /api/recipes/[id] anônimo — `params` como Promise (rota dinâmica). */
function getRecipe(id: string, locale = 'pt-BR'): Promise<Response> {
  return GET_RECIPE(new Request(`http://localhost/api/recipes/${id}?locale=${locale}`), {
    params: Promise.resolve({ id }),
  })
}

/** Invocador anônimo p/ rotas dinâmicas POST/PATCH/DELETE em /api/recipes/[id]/*. */
type DynHandler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
function callDyn(handler: DynHandler, id: string, method: string, body?: unknown): Promise<Response> {
  return handler(
    new Request(`http://localhost/api/recipes/${id}`, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    { params: Promise.resolve({ id }) },
  )
}

/** Invocador anônimo p/ rotas POST de corpo simples (sem params). */
function callPost(handler: (req: Request) => Promise<Response>, url: string, body?: unknown): Promise<Response> {
  return handler(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  )
}

// ══════════════════════════════════════════════════════════════════════════════════
// 1. LEITURA — o Anônimo PODE ler conteúdo público/catálogo; privado/removido → 404.
// ══════════════════════════════════════════════════════════════════════════════════

describe('Contrato anônimo — LEITURA (read-only liberada)', () => {
  it('GET /api/search anônimo → 200 com resultados (gate owner-NULL/public)', async () => {
    const m = await seedSearchMatrix()

    const res = await search('chili')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      catalogo: { recipeId: string }[]
      comunidade: { recipeId: string }[]
    }
    // A é catálogo (owner NULL) e aparece; B é Comunidade PÚBLICA e aparece — ambos lidos
    // por um Visitante. (As privadas/playful do matrix NÃO aparecem, mas isso é #6, não #22.)
    expect(body.catalogo.map((r) => r.recipeId)).toContain(m.A)
    expect(body.comunidade.map((r) => r.recipeId)).toContain(m.B)
  })

  it('GET /api/recipes/[id] anônimo de receita PÚBLICA → 200 com a view', async () => {
    const ownerId = await seedUser({ email: 'pub-owner@anon.test' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo público', provenance: 'escrita_por_pessoa' })

    const res = await getRecipe(id)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { name: string; canManage?: boolean; visibility?: string }
    expect(view.name).toBe('Bolo público')
    // Anônimo não recebe campos de gestão (não vaza "gerida por você").
    expect(view).not.toHaveProperty('canManage')
    expect(view).not.toHaveProperty('visibility')
  })

  it('GET /api/recipes/[id] anônimo de receita de CATÁLOGO (owner NULL) → 200', async () => {
    const { recipeId, tituloPt } = await seedFeijoadaCatalog()

    const res = await getRecipe(recipeId)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { name: string }
    expect(view.name).toBe(tituloPt)
  })

  it('GET /api/recipes/[id] anônimo de receita PRIVADA de outro → 404 (leak-safe)', async () => {
    const ownerId = await seedUser({ email: 'priv-owner@anon.test' })
    const id = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Segredo', provenance: 'escrita_por_pessoa' })

    const res = await getRecipe(id)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('GET /api/recipes/[id] anônimo de pública REMOVIDA pela moderação → 404', async () => {
    const ownerId = await seedUser({ email: 'mod-owner@anon.test' })
    const curatorId = await seedUser({ email: 'mod-curator@anon.test', role: 'curador' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Removida', provenance: 'escrita_por_pessoa' })
    await seedRemovedFromPool({ recipeId: id, curatorId })

    const res = await getRecipe(id)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════════
// 2. ESCRITA + GERAÇÃO — fail-closed (401), zero linhas, seam intocado.
// ══════════════════════════════════════════════════════════════════════════════════

describe('Contrato anônimo — ESCRITA/GERAÇÃO fail-closed (401)', () => {
  // Helper p/ semear uma receita-alvo PÚBLICA de OUTRO (alvo válido das rotas /[id]/*,
  // para provar que o 401 vem do gate de sessão, não de um 404 de receita-ausente).
  async function seedPublicTarget(email: string): Promise<string> {
    const ownerId = await seedUser({ email })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Alvo', provenance: 'escrita_por_pessoa' })
    return id
  }

  it('POST /api/generations anônimo → 401; seam intocado; ZERO linhas', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await callPost(GENERATIONS, '/api/generations', { mode: 'structured', briefing: makeBriefing() })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })
  })

  it('POST /api/conversations/stream anônimo → 401 JSON ANTES do stream; seam intocado; ZERO linhas', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await callPost(STREAM, '/api/conversations/stream', { transcript: makeTranscript() })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })
  })

  it('POST /api/creation-sessions anônimo → 401; ZERO linhas', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await callPost(CREATION_SESSIONS, '/api/creation-sessions', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })
  })

  it('POST /api/recipes/[id]/derive anônimo → 401; seam intocado; nenhuma receita nova', async () => {
    const target = await seedPublicTarget('derive-target@anon.test')
    setClaudeClient(new ExplodingClaudeClient())
    const before = await counts()

    const res = await callDyn(DERIVE, target, 'POST', { edits: {} })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    // Só a receita-alvo semeada existe — derive não criou nada.
    expect(await counts()).toEqual(before)
  })

  it('POST /api/recipes/[id]/regenerate anônimo → 401; seam intocado; nada criado', async () => {
    const target = await seedPublicTarget('regen-target@anon.test')
    setClaudeClient(new ExplodingClaudeClient())
    const before = await counts()

    const res = await callDyn(REGENERATE, target, 'POST', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await counts()).toEqual(before)
  })

  it('PATCH /api/recipes/[id] anônimo → 401 (edição in-place exige conta)', async () => {
    const target = await seedPublicTarget('patch-target@anon.test')

    const res = await callDyn(PATCH_RECIPE, target, 'PATCH', { titulo: 'hackeado' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('DELETE /api/recipes/[id] anônimo → 401 (apagar exige conta)', async () => {
    const target = await seedPublicTarget('delete-target@anon.test')

    const res = await callDyn(DELETE_RECIPE, target, 'DELETE')
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('POST /api/recipes/[id]/publish anônimo → 401 (publicar exige conta)', async () => {
    const target = await seedPublicTarget('publish-target@anon.test')

    const res = await callDyn(PUBLISH, target, 'POST', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('POST /api/recipes/[id]/vote anônimo → 401 (votar exige conta)', async () => {
    const target = await seedPublicTarget('vote-target@anon.test')

    const res = await callDyn(VOTE, target, 'POST', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('POST /api/recipes/[id]/save anônimo → 401 (salvar exige conta)', async () => {
    const target = await seedPublicTarget('save-target@anon.test')

    const res = await callDyn(SAVE, target, 'POST', {})
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('POST /api/recipes/[id]/report anônimo → 401 (denunciar exige conta)', async () => {
    const target = await seedPublicTarget('report-target@anon.test')

    const res = await callDyn(REPORT, target, 'POST', { reason: 'spam' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })
})

// ══════════════════════════════════════════════════════════════════════════════════
// 3. Garantia de DESCOPE: não existe rota de claim / persist-on-signup.
// ══════════════════════════════════════════════════════════════════════════════════

describe('Contrato anônimo — sem persistência anônima (claim DESCOPADO)', () => {
  it('o conjunto de escrita/geração é integralmente fail-closed: NENHUMA porta aceita persistência anônima', async () => {
    // A ausência de geração anônima ⇒ nada efêmero a "reivindicar" no signup. A garantia é a
    // AUSÊNCIA de qualquer rota de escrita/geração aberta ao anônimo: cada POST de criação
    // tentado SEM sessão devolve 401, e o banco fica intocado. Isto é o oposto operacional de
    // um endpoint de claim (que ACEITARIA estado anônimo e o persistiria no signup).
    setClaudeClient(new ExplodingClaudeClient())

    const attempts = [
      callPost(GENERATIONS, '/api/generations', { mode: 'structured', briefing: makeBriefing() }),
      callPost(STREAM, '/api/conversations/stream', { transcript: makeTranscript() }),
      callPost(CREATION_SESSIONS, '/api/creation-sessions', {}),
    ]
    const results = await Promise.all(attempts)
    for (const res of results) {
      expect(res.status).toBe(401)
    }

    // Zero linhas em qualquer tabela de criação: não há estado anônimo persistido para reivindicar.
    expect(await counts()).toEqual({ recipe: 0, session: 0, generation: 0, transcript: 0 })
  })
})
