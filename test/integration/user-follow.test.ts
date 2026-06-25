import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  POST as followPOST,
  DELETE as followDELETE,
  GET as followGET,
} from '@/app/api/u/[handle]/follow/route'
import { GET as profileGET } from '@/app/api/u/[handle]/route'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import {
  follow,
  countFollowers,
  countFollowing,
  listFollowers,
  listFollowing,
  viewerFollows,
  FOLLOW_LIST_PREVIEW,
} from '@/server/user/follow'
import { seedUser, seedSessionHeaders } from '../helpers/users'

/**
 * Grafo de SEGUIR (#274, ADR-0024) contra Postgres real. Cobre a API (POST/DELETE/GET assimétrica,
 * idempotente, anon→401, auto-seguir→422 ANTES do insert, 404 leak-safe de handle inexistente/soft-
 * deletado), as seams (contadores/listas que CONCORDAM gateando soft-deleted; cap do preview) e a
 * invariante de Modelo B (o perfil anon NÃO lê a sessão — bytes idênticos com e sem cookie).
 */

function followReq(method: 'POST' | 'DELETE' | 'GET', handle: string, headers?: Headers) {
  const req = new Request(`http://localhost/api/u/${handle}/follow`, {
    method,
    headers: headers ?? new Headers(),
  })
  const ctx = { params: Promise.resolve({ handle }) }
  if (method === 'POST') return followPOST(req, ctx)
  if (method === 'DELETE') return followDELETE(req, ctx)
  return followGET(req, ctx)
}

function profileReq(handle: string, headers?: Headers) {
  return profileGET(new Request(`http://localhost/api/u/${handle}`, { headers: headers ?? new Headers() }), {
    params: Promise.resolve({ handle }),
  })
}

/** O handle (auto-gerado) de um user semeado por sessão — pra exercitar o auto-seguir. */
async function handleOf(userId: string): Promise<string> {
  const [row] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return row!.handle
}

describe('POST/DELETE /api/u/[handle]/follow (#274) — seguir assimétrico', () => {
  it('anônimo → 401', async () => {
    const alvo = await seedUser({ email: 'alvo@follow.test', name: 'Alvo', handle: 'alvo-follow' })
    expect(alvo).toBeTruthy()
    const res = await followReq('POST', 'alvo-follow')
    expect(res.status).toBe(401)
  })

  it('seguir é idempotente (2× → 1 linha) e unfollow idempotente (2× → 0 linhas)', async () => {
    const followeeId = await seedUser({ email: 'f1@follow.test', name: 'F1', handle: 'f1' })
    const { userId: followerId, headers } = await seedSessionHeaders({ email: 'seguidor1@follow.test' })

    const r1 = await followReq('POST', 'f1', headers)
    expect(r1.status).toBe(200)
    await expect(r1.json()).resolves.toMatchObject({ isFollowing: true, followerCount: 1 })

    const r2 = await followReq('POST', 'f1', headers) // re-seguir → no-op
    expect(r2.status).toBe(200)
    await expect(r2.json()).resolves.toMatchObject({ isFollowing: true, followerCount: 1 })
    expect(await viewerFollows(getDb(), followerId, followeeId)).toBe(true)
    expect(await countFollowers(getDb(), followeeId)).toBe(1)

    const u1 = await followReq('DELETE', 'f1', headers)
    expect(u1.status).toBe(200)
    await expect(u1.json()).resolves.toMatchObject({ isFollowing: false, followerCount: 0 })

    const u2 = await followReq('DELETE', 'f1', headers) // deixar de seguir sem seguir → no-op
    expect(u2.status).toBe(200)
    await expect(u2.json()).resolves.toMatchObject({ isFollowing: false, followerCount: 0 })
    expect(await viewerFollows(getDb(), followerId, followeeId)).toBe(false)
    expect(await countFollowers(getDb(), followeeId)).toBe(0)
  })

  it('DELETE sem seguir antes (duplo-clique) → {isFollowing:false}, 0 linhas, sem erro', async () => {
    await seedUser({ email: 'f2@follow.test', name: 'F2', handle: 'f2' })
    const { headers } = await seedSessionHeaders({ email: 'seguidor2@follow.test' })
    const res = await followReq('DELETE', 'f2', headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ isFollowing: false })
  })

  it('auto-seguir → 422 auto_seguir e 0 linhas (CHECK do banco nunca é alcançado)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'eu@follow.test' })
    const meuHandle = await handleOf(userId)
    const res = await followReq('POST', meuHandle, headers)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toEqual({ error: 'auto_seguir' })
    expect(await countFollowing(getDb(), userId)).toBe(0)
  })

  it('handle inexistente → 404; handle soft-deletado → 404 (leak-safe)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'seguidor3@follow.test' })
    expect((await followReq('POST', 'nao-existe-mesmo', headers)).status).toBe(404)

    await seedUser({ email: 'morto@follow.test', name: 'Morto', handle: 'morto', deletedAt: new Date() })
    expect((await followReq('POST', 'morto', headers)).status).toBe(404)
  })
})

describe('GET /api/u/[handle]/follow (#274) — estado do viewer', () => {
  it('não-seguindo → {isFollowing:false,isSelf:false}; seguindo → true; próprio → isSelf:true', async () => {
    const followeeId = await seedUser({ email: 'g1@follow.test', name: 'G1', handle: 'g1' })
    const { userId: viewerId, headers } = await seedSessionHeaders({ email: 'viewer@follow.test' })

    const before = await followReq('GET', 'g1', headers)
    expect(before.headers.get('cache-control')).toBe('no-store')
    await expect(before.json()).resolves.toEqual({ isFollowing: false, isSelf: false })

    await follow(getDb(), viewerId, followeeId)
    await expect((await followReq('GET', 'g1', headers)).json()).resolves.toEqual({
      isFollowing: true,
      isSelf: false,
    })

    const meuHandle = await handleOf(viewerId)
    await expect((await followReq('GET', meuHandle, headers)).json()).resolves.toEqual({
      isFollowing: false,
      isSelf: true,
    })
  })

  it('anônimo no GET → 401', async () => {
    await seedUser({ email: 'g2@follow.test', name: 'G2', handle: 'g2' })
    expect((await followReq('GET', 'g2')).status).toBe(401)
  })
})

describe('Seams de contadores/listas (#274) — soft-deleted some, cap, order', () => {
  it('contadores e listas EXCLUEM soft-deleted (concordam)', async () => {
    const alvo = await seedUser({ email: 'alvo2@follow.test', name: 'Alvo2', handle: 'alvo2' })
    const vivo = await seedUser({ email: 'vivo@follow.test', name: 'Vivo', handle: 'vivo' })
    const morto = await seedUser({ email: 'morto2@follow.test', name: 'Morto2', handle: 'morto2' })
    await follow(getDb(), vivo, alvo)
    await follow(getDb(), morto, alvo)
    // antes do soft-delete: 2 seguidores
    expect(await countFollowers(getDb(), alvo)).toBe(2)
    expect((await listFollowers(getDb(), alvo, FOLLOW_LIST_PREVIEW)).length).toBe(2)
    // soft-delete de um seguidor → some de AMBOS (contador e lista concordam)
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, morto))
    expect(await countFollowers(getDb(), alvo)).toBe(1)
    const lista = await listFollowers(getDb(), alvo, FOLLOW_LIST_PREVIEW)
    expect(lista.map((u) => u.handle)).toEqual(['vivo'])
    expect(lista[0]).toEqual({ name: 'Vivo', handle: 'vivo', image: null })
  })

  it('preview capa em FOLLOW_LIST_PREVIEW mas o contador dá o TOTAL', async () => {
    const alvo = await seedUser({ email: 'pop@follow.test', name: 'Pop', handle: 'pop' })
    const total = FOLLOW_LIST_PREVIEW + 2 // 26
    for (let i = 0; i < total; i++) {
      const fid = await seedUser({ email: `cap${i}@follow.test`, name: `Cap ${i}`, handle: `cap-${i}` })
      await follow(getDb(), fid, alvo)
    }
    expect(await countFollowers(getDb(), alvo)).toBe(total)
    expect((await listFollowers(getDb(), alvo, FOLLOW_LIST_PREVIEW)).length).toBe(FOLLOW_LIST_PREVIEW)
  })

  it('listFollowing devolve quem o user SEGUE', async () => {
    const seguidor = await seedUser({ email: 'sg@follow.test', name: 'Sg', handle: 'sg' })
    const a = await seedUser({ email: 'a@follow.test', name: 'A', handle: 'aaa' })
    await follow(getDb(), seguidor, a)
    expect(await countFollowing(getDb(), seguidor)).toBe(1)
    expect((await listFollowing(getDb(), seguidor, FOLLOW_LIST_PREVIEW)).map((u) => u.handle)).toEqual([
      'aaa',
    ])
  })
})

describe('Perfil anon (#274) — Modelo B: contadores públicos, sem ler a sessão', () => {
  it('o DTO traz o bloco social (contadores + listas) e é IDÊNTICO com e sem cookie de sessão', async () => {
    const alvo = await seedUser({ email: 'perfil@follow.test', name: 'Perfil', handle: 'perfil-x' })
    const f = await seedUser({ email: 'segue@follow.test', name: 'Segue', handle: 'segue-x' })
    await follow(getDb(), f, alvo)
    const { headers: sessionHeaders } = await seedSessionHeaders({ email: 'logado@follow.test' })

    const anon = await profileReq('perfil-x')
    const comCookie = await profileReq('perfil-x', sessionHeaders)
    const anonBody = await anon.json()
    const cookieBody = await comCookie.json()

    // Bloco social presente e correto.
    expect(anonBody.social).toMatchObject({ followerCount: 1, followingCount: 0 })
    expect(anonBody.social.followers).toEqual([{ name: 'Segue', handle: 'segue-x', image: null }])
    // Invariante Modelo B: a rota NUNCA lê a sessão → resposta byte-a-byte igual.
    expect(JSON.stringify(cookieBody)).toBe(JSON.stringify(anonBody))
  })
})
