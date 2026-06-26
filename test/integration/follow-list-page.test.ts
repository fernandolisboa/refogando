import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { GET as followersGET } from '@/app/api/u/[handle]/followers/route'
import { GET as followingGET } from '@/app/api/u/[handle]/following/route'
import { getDb } from '@/server/deps'
import { users, userFollow } from '@/db/schema'
import {
  countFollowers,
  countFollowing,
  listFollowers,
  listFollowingPage,
  listFollowersPage,
  decodeFollowCursor,
  encodeFollowCursor,
  FOLLOW_LIST_PREVIEW,
} from '@/server/user/follow'
import { seedUser } from '../helpers/users'

/**
 * Lista COMPLETA de seguidores/seguindo paginada por cursor (#307, Stream-2 / ADR-0024 + ADR-0020
 * Modelo B). Prova as seams `listFollowersPage`/`listFollowingPage` (keyset lossless por
 * `created_at::text` + desempate pela counterparty uuid; mesmo gate soft-delete dos contadores) e as
 * rotas GET anon-públicas (sem cookie → 200, allowlist `FollowUser`, `?limit` ignorado, 404 leak-safe).
 *
 * O `created_at` (defaultNow) NÃO é controlável via `follow()`; pra cravar timestamps inserimos a aresta
 * DIRETO (com `created_at` explícito, inclusive em precisão de MICROSSEGUNDO via texto → o JS Date só tem
 * ms). users.id é uuid aleatório ⇒ NÃO assertamos ordem por inserção: só set-equality + determinismo.
 */

/** Insere a aresta com `created_at` explícito (texto p/ micro-precisão; sem texto = defaultNow). */
async function seedFollow(followerId: string, followeeId: string, createdAt?: string): Promise<void> {
  if (createdAt === undefined) {
    await getDb().insert(userFollow).values({ followerId, followeeId })
  } else {
    await getDb().execute(
      sql`insert into user_follow (follower_id, followee_id, created_at) values (${followerId}, ${followeeId}, ${createdAt}::timestamptz)`,
    )
  }
}

/** Cria N seguidores de `alvo` (handles previsíveis) e devolve seus ids. */
async function seedFollowers(alvo: string, n: number, prefix: string): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const fid = await seedUser({ email: `${prefix}${i}@flp.test`, name: `F ${i}`, handle: `${prefix}-${i}` })
    await seedFollow(fid, alvo)
    ids.push(fid)
  }
  return ids
}

/** Caminha TODAS as páginas de seguidores via nextCursor; devolve a sequência de handles e a contagem. */
async function walkFollowers(alvo: string, limit: number): Promise<{ handles: string[]; pages: number }> {
  const handles: string[] = []
  let cursor: string | null | undefined = undefined
  let pages = 0
  // Trava de segurança contra loop infinito (cursor que não avança).
  for (let guard = 0; guard < 1000; guard++) {
    const page = await listFollowersPage(getDb(), alvo, { cursor, limit })
    pages++
    handles.push(...page.items.map((u) => u.handle))
    if (page.nextCursor === null) return { handles, pages }
    cursor = page.nextCursor
  }
  throw new Error('walkFollowers não terminou (cursor não avança?)')
}

function followersReq(handle: string, query = '') {
  return followersGET(new Request(`http://localhost/api/u/${handle}/followers${query}`), {
    params: Promise.resolve({ handle }),
  })
}
function followingReq(handle: string, query = '') {
  return followingGET(new Request(`http://localhost/api/u/${handle}/following${query}`), {
    params: Promise.resolve({ handle }),
  })
}

describe('listFollowersPage/listFollowingPage (#307) — paginação por cursor', () => {
  it('caminha todas as páginas: união == contador, ZERO dups, ZERO skips', async () => {
    const alvo = await seedUser({ email: 'alvo@flp.test', name: 'Alvo', handle: 'alvo' })
    const total = FOLLOW_LIST_PREVIEW + 3 // 27 → força > 1 página com o page-size default
    await seedFollowers(alvo, total, 'seg')

    const { handles } = await walkFollowers(alvo, FOLLOW_LIST_PREVIEW)
    expect(handles.length).toBe(total)
    expect(new Set(handles).size).toBe(total) // sem duplicatas
    expect(await countFollowers(getDb(), alvo)).toBe(total)
    // Set-equality com a leitura "tudo de uma vez" (ordem por uuid aleatório ⇒ só comparo conjuntos).
    const todos = (await listFollowers(getDb(), alvo, 1000)).map((u) => u.handle)
    expect(new Set(handles)).toEqual(new Set(todos))
  })

  it('é determinística: duas paginações idênticas dão a MESMA sequência', async () => {
    const alvo = await seedUser({ email: 'det@flp.test', name: 'Det', handle: 'det' })
    await seedFollowers(alvo, 10, 'det')
    const a = await walkFollowers(alvo, 3)
    const b = await walkFollowers(alvo, 3)
    expect(a.handles).toEqual(b.handles)
  })

  it('nextCursor === null SÓ na última página (vem do probe limit+1, não de items.length<limit)', async () => {
    const alvo = await seedUser({ email: 'np@flp.test', name: 'Np', handle: 'np' })
    await seedFollowers(alvo, 6, 'np') // limit 2 ⇒ páginas [2,2,2], cursor não-null nas 2 primeiras
    const limit = 2
    let cursor: string | null | undefined = undefined
    const cursors: (string | null)[] = []
    for (let i = 0; i < 10; i++) {
      const page: Awaited<ReturnType<typeof listFollowersPage>> = await listFollowersPage(getDb(), alvo, {
        cursor,
        limit,
      })
      cursors.push(page.nextCursor)
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    // 3 páginas cheias: as 2 primeiras têm cursor, a última é null.
    expect(cursors.length).toBe(3)
    expect(cursors[0]).not.toBeNull()
    expect(cursors[1]).not.toBeNull()
    expect(cursors[2]).toBeNull()
  })

  it('empate de MESMO milissegundo: split sem buraco (desempate pela counterparty uuid)', async () => {
    const alvo = await seedUser({ email: 'tie@flp.test', name: 'Tie', handle: 'tie' })
    const ts = '2026-06-26T12:00:00.000Z'
    const a = await seedUser({ email: 'tiea@flp.test', name: 'TieA', handle: 'tie-a' })
    const b = await seedUser({ email: 'tieb@flp.test', name: 'TieB', handle: 'tie-b' })
    const c = await seedUser({ email: 'tiec@flp.test', name: 'TieC', handle: 'tie-c' })
    await seedFollow(a, alvo, ts)
    await seedFollow(b, alvo, ts)
    await seedFollow(c, alvo, ts)
    const { handles } = await walkFollowers(alvo, 1) // 1 por página força o boundary no empate
    expect(new Set(handles)).toEqual(new Set(['tie-a', 'tie-b', 'tie-c']))
    expect(handles.length).toBe(3) // sem skip nem dup apesar do created_at idêntico
  })

  it('micro-precisão: linhas a 1µs de distância splitam certo (cursor lossless, não ms-truncado)', async () => {
    const alvo = await seedUser({ email: 'mic@flp.test', name: 'Mic', handle: 'mic' })
    const a = await seedUser({ email: 'mica@flp.test', name: 'MicA', handle: 'mic-a' })
    const b = await seedUser({ email: 'micb@flp.test', name: 'MicB', handle: 'mic-b' })
    // Mesmo ms, diferem só no micro: um cursor truncado a ms perderia a 2ª linha.
    await seedFollow(a, alvo, '2026-06-26T12:00:00.000001Z')
    await seedFollow(b, alvo, '2026-06-26T12:00:00.000002Z')
    const { handles } = await walkFollowers(alvo, 1)
    expect(new Set(handles)).toEqual(new Set(['mic-a', 'mic-b']))
    expect(handles.length).toBe(2)
  })

  it('soft-deleted some de TODA página e o total paginado == contador gateado', async () => {
    const alvo = await seedUser({ email: 'sd@flp.test', name: 'Sd', handle: 'sd' })
    const vivo = await seedUser({ email: 'sdvivo@flp.test', name: 'Vivo', handle: 'sd-vivo' })
    const morto = await seedUser({ email: 'sdmorto@flp.test', name: 'Morto', handle: 'sd-morto' })
    await seedFollow(vivo, alvo)
    await seedFollow(morto, alvo)
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, morto))
    const { handles } = await walkFollowers(alvo, 1)
    expect(handles).not.toContain('sd-morto')
    expect(new Set(handles)).toEqual(new Set(['sd-vivo']))
    expect(handles.length).toBe(await countFollowers(getDb(), alvo))
  })

  it('listFollowingPage devolve quem o user SEGUE (mesma máquina, counterparty = followee)', async () => {
    const seguidor = await seedUser({ email: 'fg@flp.test', name: 'Fg', handle: 'fg' })
    const a = await seedUser({ email: 'fga@flp.test', name: 'A', handle: 'fg-a' })
    const b = await seedUser({ email: 'fgb@flp.test', name: 'B', handle: 'fg-b' })
    await seedFollow(seguidor, a)
    await seedFollow(seguidor, b)
    let cursor: string | null | undefined = undefined
    const handles: string[] = []
    for (let i = 0; i < 10; i++) {
      const page = await listFollowingPage(getDb(), seguidor, { cursor, limit: 1 })
      handles.push(...page.items.map((u) => u.handle))
      if (page.nextCursor === null) break
      cursor = page.nextCursor
    }
    expect(new Set(handles)).toEqual(new Set(['fg-a', 'fg-b']))
    expect(await countFollowing(getDb(), seguidor)).toBe(2)
  })
})

describe('decodeFollowCursor (#307) — cursor opaco, malformado nunca lança', () => {
  it('round-trip de um cursor real', () => {
    const ts = '2026-06-26 12:00:00.000123+00'
    const id = '11111111-1111-1111-1111-111111111111'
    const enc = encodeFollowCursor({ ts, id })
    expect(decodeFollowCursor(enc)).toEqual({ ts, id })
  })

  it('malformados → null (tratados como primeira página, nunca throw)', () => {
    for (const bad of ['', 'garbage', '!!!notbase64!!!', Buffer.from('semseparador').toString('base64url'), Buffer.from('|sovazio').toString('base64url'), Buffer.from('sovazio|').toString('base64url')]) {
      expect(decodeFollowCursor(bad)).toBeNull()
    }
  })

  it('estruturalmente-válido mas INJETÁVEL → null (nunca chega ao cast ::timestamptz/::uuid)', () => {
    // Ambos passam o split do `|` mas falham a validação de conteúdo: `x|y` (ts não-data + id não-uuid)
    // e ts-válido + id-não-uuid. Sem a validação, o bind `::timestamptz`/`::uuid` daria 500 na rota anon.
    expect(decodeFollowCursor(encodeFollowCursor({ ts: 'x', id: 'y' }))).toBeNull()
    expect(decodeFollowCursor(encodeFollowCursor({ ts: '2020-01-01', id: 'notauuid' }))).toBeNull()
  })
})

describe('GET /api/u/[handle]/followers|following (#307) — rota anon pública', () => {
  it('anon (sem cookie) → 200; items são FollowUser (sem id/role/email)', async () => {
    const alvo = await seedUser({ email: 'rota@flp.test', name: 'Rota', handle: 'rota' })
    const f = await seedUser({ email: 'rotaf@flp.test', name: 'Segue', handle: 'rota-f' })
    await seedFollow(f, alvo)
    const res = await followersReq('rota')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null }
    expect(body.items).toEqual([{ name: 'Segue', handle: 'rota-f', image: null }])
    expect(Object.keys(body.items[0] as object).sort()).toEqual(['handle', 'image', 'name'])
    expect(body.nextCursor).toBeNull()
  })

  it('?limit é IGNORADO (server-controlled = FOLLOW_LIST_PREVIEW)', async () => {
    const alvo = await seedUser({ email: 'lim@flp.test', name: 'Lim', handle: 'lim' })
    await seedFollowers(alvo, FOLLOW_LIST_PREVIEW + 2, 'lim')
    const res = await followersReq('lim', '?limit=9999')
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null }
    expect(body.items.length).toBe(FOLLOW_LIST_PREVIEW)
    expect(body.nextCursor).not.toBeNull() // ainda há mais
  })

  it('?cursor malformado → 200 primeira página (não 500)', async () => {
    const alvo = await seedUser({ email: 'mc@flp.test', name: 'Mc', handle: 'mc' })
    const f = await seedUser({ email: 'mcf@flp.test', name: 'McF', handle: 'mc-f' })
    await seedFollow(f, alvo)
    const res = await followersReq('mc', '?cursor=lixo!!!')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { handle: string }[] }
    expect(body.items.map((u) => u.handle)).toEqual(['mc-f'])
  })

  it('?cursor estruturalmente-válido mas injetável → 200 primeira página (não 500)', async () => {
    const alvo = await seedUser({ email: 'inj@flp.test', name: 'Inj', handle: 'inj' })
    const f = await seedUser({ email: 'injf@flp.test', name: 'InjF', handle: 'inj-f' })
    await seedFollow(f, alvo)
    // `x|y`: passa o split, mas `x` não é data e `y` não é uuid → decode null → primeira página.
    const cur = encodeFollowCursor({ ts: 'x', id: 'y' })
    const res = await followersReq('inj', `?cursor=${encodeURIComponent(cur)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { handle: string }[] }
    expect(body.items.map((u) => u.handle)).toEqual(['inj-f'])
  })

  it('handle inexistente → 404; soft-deletado → 404 (leak-safe)', async () => {
    expect((await followersReq('nao-existe-mesmo')).status).toBe(404)
    expect((await followingReq('nao-existe-mesmo')).status).toBe(404)
    await seedUser({ email: 'rotamorta@flp.test', name: 'Morta', handle: 'rota-morta', deletedAt: new Date() })
    expect((await followersReq('rota-morta')).status).toBe(404)
    expect((await followingReq('rota-morta')).status).toBe(404)
  })

  it('following anon: lista quem o handle SEGUE', async () => {
    const seguidor = await seedUser({ email: 'rg@flp.test', name: 'Rg', handle: 'rg' })
    const a = await seedUser({ email: 'rga@flp.test', name: 'A', handle: 'rg-a' })
    await seedFollow(seguidor, a)
    const res = await followingReq('rg')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: { handle: string }[] }
    expect(body.items.map((u) => u.handle)).toEqual(['rg-a'])
  })
})
