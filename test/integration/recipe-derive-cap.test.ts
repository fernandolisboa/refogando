import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { POST as deriveRoute } from '@/app/api/recipes/[id]/derive/route'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { RECIPE_GEN_WINDOW_MS } from '@/domain/recipe-gen-quota'
import { DERIVE_CAP_BY_ROLE } from '@/domain/derive-cap'
import { DERIVE_LOCK_BUSY_RETRY_MS, QUOTA_LOCK_CLASS } from '@/server/quota/atomic'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Teto anti-abuso de Derivar/Clonar (#588, ADR-0045 emenda 2026-10-22) pela porta mais alta.
 *
 * A contagem é das `recipe` VIVAS `origin='user_edited'` do usuário na janela 24h (sem ledger), então
 * semeamos derivadas direto no banco pra chegar perto do teto sem 30 POSTs, e movemos `created_at` com
 * UPDATE pra simular "fora da janela". Concorrência no molde do #446: `Promise.all` de N POSTs prova que
 * nascem EXATAMENTE as que cabem (o gate é a 1ª operação da tx do fork, sob advisory lock do usuário).
 * `setup.ts` trunca por teste.
 */

const CAP = DERIVE_CAP_BY_ROLE.usuario as number

// Conexão À PARTE (fora do pool do app) pra segurar a advisory lock do derive enquanto a rota espera.
let holderSql: Sql
beforeAll(() => {
  holderSql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await holderSql?.end({ timeout: 5 })
})

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

function post(id: string, body: unknown, headers: Headers): Promise<Response> {
  return deriveRoute(
    new Request(`http://localhost/api/recipes/${id}/derive?locale=pt-BR`, {
      method: 'POST',
      headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    ctx(id),
  )
}

const clone = (id: string, headers: Headers) => post(id, { clone: true }, headers)
const deriveEdited = (id: string, headers: Headers) =>
  post(id, { edits: { titulo: 'Minha versão', ingredientes: [{ rawText: 'sal', quantidade: null }] } }, headers)

/** Base de catálogo forkável (curada), com 1 tradução e 1 ingrediente. */
async function seedBase(): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Arroz', provenance: 'escrita_por_pessoa' })
  await seedRecipeIngredient({ recipeId: id, ordem: 0, rawText: 'sal' })
  return id
}

/** `n` derivadas JÁ existentes do usuário (`user_edited`, criadas agora — dentro da janela). */
async function seedDerived(ownerId: string, n: number, parentRecipeId: string): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    ids.push(
      await seedRecipe({ origin: 'user_edited', originalLocale: 'pt-BR', ownerId, parentRecipeId, lineageKind: 'edited' }),
    )
  }
  return ids
}

async function countDerived(ownerId: string): Promise<number> {
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(recipe)
    .where(and(eq(recipe.ownerId, ownerId), eq(recipe.origin, 'user_edited')))
  return r.n
}

async function ageRecipe(id: string, ms: number): Promise<void> {
  await getDb()
    .update(recipe)
    .set({ createdAt: new Date(Date.now() - ms) })
    .where(eq(recipe.id, id))
}

describe('POST /api/recipes/[id]/derive — teto de derivar (#588)', () => {
  it('no teto: derivar E clonar ⇒ 429 limite_derivar + retryAfterMs até a mais antiga sair; nada nasce', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-hit@derive.test' })
    const baseId = await seedBase()
    const ids = await seedDerived(userId, CAP, baseId)
    // A mais antiga há 23h ⇒ libera em ~1h.
    await ageRecipe(ids[0], 23 * 60 * 60_000)

    for (const res of [await deriveEdited(baseId, headers), await clone(baseId, headers)]) {
      expect(res.status).toBe(429)
      const body = (await res.json()) as { error: string; retryAfterMs: number }
      expect(body.error).toBe('limite_derivar')
      expect(body.retryAfterMs).toBeGreaterThan(55 * 60_000)
      expect(body.retryAfterMs).toBeLessThanOrEqual(60 * 60_000)
    }
    expect(await countDerived(userId)).toBe(CAP)
  })

  it('a 30ª passa, a 31ª estoura (caminho real do fork, não só seed)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-edge@derive.test' })
    const baseId = await seedBase()
    await seedDerived(userId, CAP - 1, baseId)

    expect((await clone(baseId, headers)).status).toBe(201)
    expect((await deriveEdited(baseId, headers)).status).toBe(429)
    expect(await countDerived(userId)).toBe(CAP)
  })

  it('fora da janela não conta: derivadas de >24h atrás ⇒ 201', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-window@derive.test' })
    const baseId = await seedBase()
    const ids = await seedDerived(userId, CAP, baseId)
    await ageRecipe(ids[0], RECIPE_GEN_WINDOW_MS + 60_000)

    expect((await clone(baseId, headers)).status).toBe(201)
  })

  it('conta só as linhas VIVAS: apagar uma derivada libera o slot (limite aceito na emenda)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-delete@derive.test' })
    const baseId = await seedBase()
    const ids = await seedDerived(userId, CAP, baseId)
    expect((await clone(baseId, headers)).status).toBe(429)

    await getDb().delete(recipe).where(eq(recipe.id, ids[0]))
    expect((await clone(baseId, headers)).status).toBe(201)
  })

  it('o teto é por usuário: as derivadas de OUTRO não contam', async () => {
    const other = await seedUser({ email: 'cap-other@derive.test' })
    const { headers } = await seedSessionHeaders({ email: 'cap-me@derive.test' })
    const baseId = await seedBase()
    await seedDerived(other, CAP, baseId)

    expect((await clone(baseId, headers)).status).toBe(201)
  })

  it('admin é isento (∞): acima do teto do usuario ⇒ 201', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-admin@derive.test', role: 'admin' })
    const baseId = await seedBase()
    await seedDerived(userId, CAP + 2, baseId)

    expect((await clone(baseId, headers)).status).toBe(201)
  })

  it('ordem dos guards: no teto, própria ⇒ 409, inexistente ⇒ 404, corpo inválido ⇒ 400 (nunca 429)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-order@derive.test' })
    const baseId = await seedBase()
    const ids = await seedDerived(userId, CAP, baseId)

    expect((await clone(ids[0], headers)).status).toBe(409)
    expect((await clone('00000000-0000-4000-8000-000000000000', headers)).status).toBe(404)
    expect((await post(baseId, { clone: true, edits: {} }, headers)).status).toBe(400)
  })

  it('lock presa além do lock_timeout (rajada enfileirada) ⇒ 429 limite_derivar com retry curto, nunca 500', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-lock@derive.test' })
    const baseId = await seedBase()

    // Outra conexão segura a MESMA chave (classe do derive + hashtext(userId)) até o POST voltar.
    let release!: () => void
    const released = new Promise<void>((r) => (release = r))
    let locked!: () => void
    const isLocked = new Promise<void>((r) => (locked = r))
    const holder = holderSql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${QUOTA_LOCK_CLASS.derive}::int, hashtext(${userId}))`
      locked()
      await released
    })
    try {
      await isLocked
      const res = await clone(baseId, headers)
      expect(res.status).toBe(429)
      await expect(res.json()).resolves.toEqual({ error: 'limite_derivar', retryAfterMs: DERIVE_LOCK_BUSY_RETRY_MS })
    } finally {
      release()
      await holder
    }
    expect(await countDerived(userId)).toBe(0)

    // Lock livre ⇒ o fork segue normal (o lock_timeout do SET LOCAL não vaza pra conexão do pool).
    expect((await clone(baseId, headers)).status).toBe(201)
  })

  it('concorrência (#446): 3 slots livres, 8 POSTs simultâneos ⇒ EXATAMENTE 3 nascem (201), 5 estouram (429)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'cap-race@derive.test' })
    const baseId = await seedBase()
    await seedDerived(userId, CAP - 3, baseId)

    // Todas passam o peek estale (contagem 27 < 30); só o gate ATÔMICO na tx do fork segura o teto.
    const results = await Promise.all(Array.from({ length: 8 }, () => clone(baseId, headers)))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses.filter((s) => s === 201)).toHaveLength(3)
    expect(statuses.filter((s) => s === 429)).toHaveLength(5)
    for (const r of results.filter((x) => x.status === 429)) {
      expect(((await r.json()) as { error: string }).error).toBe('limite_derivar')
    }
    expect(await countDerived(userId)).toBe(CAP)
  })
})
