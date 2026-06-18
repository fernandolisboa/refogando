import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { PostgresError } from 'postgres'
import { eq, and } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipeVote, recipeFavorite } from '@/db/schema'
import { POST as voteRoute } from '@/app/api/recipes/[id]/vote/route'
import { POST as unvoteRoute } from '@/app/api/recipes/[id]/unvote/route'
import { POST as favoriteRoute } from '@/app/api/recipes/[id]/favorite/route'
import { POST as unfavoriteRoute } from '@/app/api/recipes/[id]/unfavorite/route'
import { POST as publishRoute } from '@/app/api/recipes/[id]/publish/route'
import { POST as unpublishRoute } from '@/app/api/recipes/[id]/unpublish/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { GET as searchRoute } from '@/app/api/search/route'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedIngredient,
  seedRecipeIngredient,
} from '../helpers/recipes'

/**
 * Voto + Favorito + estado leak-safe pela porta mais alta (issue #16, ADR-0003).
 * `setup.ts` aponta o DI para o Postgres descartável e trunca antes de cada teste.
 * Invariantes cruas (PK composta 23505) usam um cliente RAW postgres-js (`makeSql`).
 * Modelo de invocação: recipes-publish.test.ts (Request cru + params Promise).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function vote(id: string, headers?: Headers): Promise<Response> {
  return voteRoute(new Request(`http://localhost/api/recipes/${id}/vote`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function unvote(id: string, headers?: Headers): Promise<Response> {
  return unvoteRoute(new Request(`http://localhost/api/recipes/${id}/unvote`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function favorite(id: string, headers?: Headers): Promise<Response> {
  return favoriteRoute(new Request(`http://localhost/api/recipes/${id}/favorite`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function unfavorite(id: string, headers?: Headers): Promise<Response> {
  return unfavoriteRoute(new Request(`http://localhost/api/recipes/${id}/unfavorite`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function publish(id: string, headers?: Headers): Promise<Response> {
  return publishRoute(new Request(`http://localhost/api/recipes/${id}/publish`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function unpublish(id: string, headers?: Headers): Promise<Response> {
  return unpublishRoute(new Request(`http://localhost/api/recipes/${id}/unpublish`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function get(id: string, headers?: Headers): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}
function search(qs: string): Promise<Response> {
  return searchRoute(new Request(`http://localhost/api/search?${qs}`))
}

// ── Leitores de estado cru ──────────────────────────────────────────────────────
async function countVotes(id: string): Promise<number> {
  const rows = await getDb().select().from(recipeVote).where(eq(recipeVote.recipeId, id))
  return rows.length
}
async function countFavorites(id: string): Promise<number> {
  const rows = await getDb().select().from(recipeFavorite).where(eq(recipeFavorite.recipeId, id))
  return rows.length
}
async function favoriteExists(userId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .select()
    .from(recipeFavorite)
    .where(and(eq(recipeFavorite.userId, userId), eq(recipeFavorite.recipeId, id)))
  return rows.length > 0
}

/** Receita de Comunidade PÚBLICA com dono distinto do votante (votável por outro). */
async function seedPublicCommunity(ownerId: string): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    resultKind: 'success',
    ownerId,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })
  return id
}

type VoteBody = { voteCount: number; viewerVoted: boolean }
type FavBody = { viewerFavorited: boolean }

describe('POST /api/recipes/[id]/{vote,unvote,favorite,unfavorite} (#16)', () => {
  // ── AC1: idempotência + desfazer ───────────────────────────────────────────────
  it('AC1 votar 2× (mesmo user,recipe) ⇒ ambas 200, voteCount=1; unvote ⇒ 0; re-unvote ⇒ no-op', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac1-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'ac1-voter@ex.com' })
    const id = await seedPublicCommunity(owner)

    const first = await vote(id, headers)
    expect(first.status).toBe(200)
    expect((await first.json()) as VoteBody).toEqual({ voteCount: 1, viewerVoted: true })

    const second = await vote(id, headers)
    expect(second.status).toBe(200)
    expect((await second.json()) as VoteBody).toEqual({ voteCount: 1, viewerVoted: true })
    expect(await countVotes(id)).toBe(1)

    const un = await unvote(id, headers)
    expect(un.status).toBe(200)
    expect((await un.json()) as VoteBody).toEqual({ voteCount: 0, viewerVoted: false })
    expect(await countVotes(id)).toBe(0)

    // re-unvote (não votou) ⇒ no-op 200.
    const reUn = await unvote(id, headers)
    expect(reUn.status).toBe(200)
    expect((await reUn.json()) as VoteBody).toEqual({ voteCount: 0, viewerVoted: false })
  })

  it('AC1 favoritar 2× ⇒ ambas 200, 1 linha; unfavorite ⇒ 0; re-unfavorite ⇒ no-op', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac1f-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'ac1f-fav@ex.com' })
    const id = await seedPublicCommunity(owner)

    const first = await favorite(id, headers)
    expect(first.status).toBe(200)
    expect((await first.json()) as FavBody).toEqual({ viewerFavorited: true })

    const second = await favorite(id, headers)
    expect(second.status).toBe(200)
    expect((await second.json()) as FavBody).toEqual({ viewerFavorited: true })
    expect(await countFavorites(id)).toBe(1)

    const un = await unfavorite(id, headers)
    expect(un.status).toBe(200)
    expect((await un.json()) as FavBody).toEqual({ viewerFavorited: false })
    expect(await countFavorites(id)).toBe(0)

    const reUn = await unfavorite(id, headers)
    expect(reUn.status).toBe(200)
    expect((await reUn.json()) as FavBody).toEqual({ viewerFavorited: false })
  })

  it('AC1 smoke de schema: INSERT cru duplicado em recipe_vote ⇒ PostgresError 23505 (PK composta)', async () => {
    const userId = (await seedSessionHeaders({ email: 'ac1raw@ex.com' })).userId
    const owner = (await seedSessionHeaders({ email: 'ac1raw-owner@ex.com' })).userId
    const id = await seedPublicCommunity(owner)

    await sql`INSERT INTO recipe_vote (user_id, recipe_id) VALUES (${userId}, ${id})`
    let err: unknown
    try {
      await sql`INSERT INTO recipe_vote (user_id, recipe_id) VALUES (${userId}, ${id})`
    } catch (e) {
      err = e
    }
    expect((err as PostgresError).code).toBe('23505')
  })

  it('AC1 concorrência: Promise.all de duas chamadas vote pela porta real ⇒ ambas 200, COUNT=1', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'conc-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'conc-voter@ex.com' })
    const id = await seedPublicCommunity(owner)

    const [a, b] = await Promise.all([vote(id, headers), vote(id, headers)])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(await countVotes(id)).toBe(1)
  })

  // ── AC2: não-autovoto imposto no servidor ──────────────────────────────────────
  it('AC2 dono vota na PRÓPRIA receita ⇒ 422 auto_voto E COUNT=0 (nada gravado)', async () => {
    const { userId: owner, headers: ownerHeaders } = await seedSessionHeaders({ email: 'ac2-owner@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await vote(id, ownerHeaders)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'auto_voto' })
    expect(await countVotes(id)).toBe(0)
  })

  it('AC2 dono FAVORITA a própria receita ⇒ 200 (favorito é marcador pessoal, não popularidade)', async () => {
    const { userId: owner, headers: ownerHeaders } = await seedSessionHeaders({ email: 'ac2f-owner@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await favorite(id, ownerHeaders)
    expect(res.status).toBe(200)
    expect((await res.json()) as FavBody).toEqual({ viewerFavorited: true })
    expect(await countFavorites(id)).toBe(1)
  })

  // ── AC6: anônimo → 401, zero efeito; conta desativada → 401 ─────────────────────
  it.each<[string, (id: string, h?: Headers) => Promise<Response>]>([
    ['vote', vote],
    ['unvote', unvote],
    ['favorite', favorite],
    ['unfavorite', unfavorite],
  ])('AC6 anônimo %s ⇒ 401 nao_autenticado e ZERO efeito no DB', async (_name, route) => {
    const { userId: owner } = await seedSessionHeaders({ email: `ac6-owner-${_name}@ex.com` })
    const id = await seedPublicCommunity(owner)

    const res = await route(id) // sem headers
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
    expect(await countVotes(id)).toBe(0)
    expect(await countFavorites(id)).toBe(0)
  })

  it('AC6 conta soft-deletada ⇒ 401 conta_desativada (vote), zero efeito', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac6del-owner@ex.com' })
    const { headers } = await seedDeletedSessionHeaders({ email: 'ac6del-voter@ex.com' })
    const id = await seedPublicCommunity(owner)

    const res = await vote(id, headers)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'conta_desativada' })
    expect(await countVotes(id)).toBe(0)
  })

  it('AC6 visitante (anônimo) navega o pool por sort=popularidade (lista normalmente)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac6nav-owner@ex.com' })
    const { headers: voterHeaders } = await seedSessionHeaders({ email: 'ac6nav-voter@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: owner,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Chili popular', provenance: 'escrita_por_pessoa' })
    await vote(id, voterHeaders)

    // GET anônimo (sem headers) da busca por popularidade ⇒ lista a Comunidade.
    const res = await search('q=chili&sort=popularidade')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { comunidade: { recipeId: string }[] }
    expect(body.comunidade.map((r) => r.recipeId)).toContain(id)
  })

  // ── not_found: fora do pool / inexistente / id inválido ─────────────────────────
  it('vote em receita PRIVADA de OUTRO ⇒ 404 (gate de pool, não vaza existência)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'priv-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'priv-voter@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: owner,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Segredo', provenance: 'escrita_por_pessoa' })

    const res = await vote(id, headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
    expect(await countVotes(id)).toBe(0)
  })

  it('vote em receita PLAYFUL ⇒ 404 (popularidade não tem autoridade sobre playful)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'play-owner@ex.com' })
    const { headers } = await seedSessionHeaders({ email: 'play-voter@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      resultKind: 'playful',
      ownerId: owner,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Zoeira', provenance: 'escrita_por_pessoa' })

    const res = await vote(id, headers)
    expect(res.status).toBe(404)
    expect(await countVotes(id)).toBe(0)
  })

  it('vote id não-uuid ⇒ 404 (curto-circuito isUuid, sem 500); uuid inexistente ⇒ 404', async () => {
    const { headers } = await seedSessionHeaders({ email: 'badid@ex.com' })
    const bad = await vote('not-a-uuid', headers)
    expect(bad.status).toBe(404)
    const missing = await vote('00000000-0000-0000-0000-000000000000', headers)
    expect(missing.status).toBe(404)
  })

  // ── Catálogo votável + leak-safe (gate de POOL ≠ ownership) ──────────────────────
  it('Catálogo (owner NULL) é votável/favoritável ⇒ 200; GET do mesmo user vê viewerVoted/viewerFavorited', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cat-user@ex.com' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })

    const v = await vote(id, headers)
    expect(v.status).toBe(200)
    expect((await v.json()) as VoteBody).toEqual({ voteCount: 1, viewerVoted: true })
    const f = await favorite(id, headers)
    expect(f.status).toBe(200)

    // GET com headers do MESMO usuário ⇒ viewerVoted/viewerFavorited true + voteCount.
    const mine = await get(id, headers)
    expect(mine.status).toBe(200)
    const view = (await mine.json()) as {
      viewerVoted?: boolean
      viewerFavorited?: boolean
      voteCount?: number
      canManage?: boolean
    }
    expect(view.viewerVoted).toBe(true)
    expect(view.viewerFavorited).toBe(true)
    expect(view.voteCount).toBe(1)
    // Catálogo nunca tem dono ⇒ nunca canManage (leak-safe de gestão preservado).
    expect(view.canManage).toBeUndefined()
  })

  it('leak-safe: GET ANÔNIMO de Catálogo votado ⇒ viewerVoted/viewerFavorited AUSENTES; voteCount presente', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cat-voter2@ex.com' })
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })
    await vote(id, headers)

    const anon = await get(id) // sem headers
    expect(anon.status).toBe(200)
    const view = (await anon.json()) as { viewerVoted?: boolean; viewerFavorited?: boolean; voteCount?: number }
    expect(view.viewerVoted).toBeUndefined()
    expect(view.viewerFavorited).toBeUndefined()
    expect(view.voteCount).toBe(1) // agregado público presente p/ anônimo no pool
  })

  it("leak-safe: GET de outro usuário logado NÃO vê o voto alheio (viewerVoted false), mas vê voteCount", async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'leak-owner@ex.com' })
    const { headers: voterHeaders } = await seedSessionHeaders({ email: 'leak-voter@ex.com' })
    const { headers: otherHeaders } = await seedSessionHeaders({ email: 'leak-other@ex.com' })
    const id = await seedPublicCommunity(owner)
    await vote(id, voterHeaders)

    const res = await get(id, otherHeaders)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { viewerVoted?: boolean; viewerFavorited?: boolean; voteCount?: number }
    expect(view.viewerVoted).toBe(false) // presente (logado) mas próprio estado: não votou
    expect(view.viewerFavorited).toBe(false)
    expect(view.voteCount).toBe(1) // agregado público
  })

  it('voteCount AUSENTE em owned-private: dono faz GET da PRÓPRIA receita privada ⇒ voteCount não presente (não 0)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'ownedpriv@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Rascunho', provenance: 'escrita_por_pessoa' })

    const res = await get(id, headers)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { voteCount?: number; viewerVoted?: boolean; canManage?: boolean }
    expect(view.voteCount).toBeUndefined() // fora do pool ⇒ omitido (não 0)
    expect(view.canManage).toBe(true) // dono vê gestão
    // viewerVoted presente (logado, viewer-self) mesmo em owned-private — não vaza nada alheio.
    expect(view.viewerVoted).toBe(false)
  })

  // ── AC4: votos NÃO suprimem o aviso de restrição (ADR-0004) ─────────────────────
  it('AC4 receita do pool com contradição (vegana + alérgeno) e MUITOS votos ⇒ avisos PRESENTE', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac4-owner@ex.com' })
    // contradição: restrição vegano + ingrediente com alérgeno de origem animal.
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: owner,
      restricoes: ['vegano'],
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo vegano', provenance: 'escrita_por_pessoa' })
    const ing = await seedIngredient({ slug: null, alergenos: ['leite'] })
    await seedRecipeIngredient({ recipeId: id, ingredientId: ing, ordem: 0, quantidade: '1.000', unidade: 'unidade' })

    // votos altos por vários usuários distintos.
    for (let i = 0; i < 3; i++) {
      const u = await seedSessionHeaders({ email: `ac4-voter-${i}@ex.com` })
      await vote(id, u.headers)
    }
    expect(await countVotes(id)).toBe(3)

    const res = await get(id)
    expect(res.status).toBe(200)
    const view = (await res.json()) as { avisos?: unknown[]; voteCount?: number }
    expect(Array.isArray(view.avisos)).toBe(true)
    expect(view.avisos!.length).toBeGreaterThan(0) // votos NÃO suprimem o aviso
    expect(view.voteCount).toBe(3) // e o agregado coexiste com o aviso
  })

  // ── AC5: despublicar preserva votos; some p/ favoritador; republicar mantém ──────
  it('AC5 round-trip: unpublish PRESERVA votos/favoritos; some do pool; republicar mantém contagem', async () => {
    const { userId: owner, headers: ownerHeaders } = await seedSessionHeaders({ email: 'ac5-owner@ex.com' })
    const { userId: favId, headers: favHeaders } = await seedSessionHeaders({ email: 'ac5-fav@ex.com' })
    const { headers: voter2 } = await seedSessionHeaders({ email: 'ac5-voter2@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: owner,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Chili da casa', provenance: 'escrita_por_pessoa' })

    // N=2 votos (favId + voter2), M=1 favorito (favId).
    await vote(id, favHeaders)
    await vote(id, voter2)
    await favorite(id, favHeaders)
    expect(await countVotes(id)).toBe(2)
    expect(await countFavorites(id)).toBe(1)

    // despublica (dono).
    const unp = await unpublish(id, ownerHeaders)
    expect(unp.status).toBe(200)

    // votos/favoritos PERSISTEM (unpublish é UPDATE, não DELETE).
    expect(await countVotes(id)).toBe(2)
    expect(await countFavorites(id)).toBe(1)
    expect(await favoriteExists(favId, id)).toBe(true) // a linha de favorito existe no DB

    // some do pool: busca da Comunidade NÃO traz a despublicada.
    const s1 = (await (await search('q=chili&sort=popularidade')).json()) as {
      comunidade: { recipeId: string }[]
    }
    expect(s1.comunidade.map((r) => r.recipeId)).not.toContain(id)

    // favoritador faz GET ⇒ 404 (privada de outro): favorito existe, mas a receita saiu do pool.
    const favGet = await get(id, favHeaders)
    expect(favGet.status).toBe(404)

    // republica (dono): volta ao pool e voteCount INTACTO.
    const pub = await publish(id, ownerHeaders)
    expect(pub.status).toBe(200)
    expect(await countVotes(id)).toBe(2) // contagem intacta

    const s2 = (await (await search('q=chili&sort=popularidade')).json()) as {
      comunidade: { recipeId: string }[]
    }
    expect(s2.comunidade.map((r) => r.recipeId)).toContain(id)

    // GET anônimo confirma o voteCount intacto.
    const after = await get(id)
    const view = (await after.json()) as { voteCount?: number }
    expect(view.voteCount).toBe(2)
  })
})
