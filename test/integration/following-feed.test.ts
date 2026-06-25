import { describe, expect, it } from 'vitest'
import { GET as followingFeedGET } from '@/app/api/feed/following/route'
import { getDb } from '@/server/deps'
import { loadFollowingFeed } from '@/server/recipe/feed'
import { follow, listFollowingIds } from '@/server/user/follow'
import type { SearchResult } from '@/domain/recipe-search-read'
import { seedUser, seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedRemovedFromPool, seedRecipeImage } from '../helpers/recipes'
import type { Origin } from '@/domain/recipe'

/**
 * Feed SEGUINDO (#277, ADR-0024) contra Postgres real. Cobre o loader (`loadFollowingFeed` —
 * filtro por seguidos + gate de pool: catálogo/privada-3º/removida/playful/web_imported AUSENTES;
 * imagem moderada some; followee soft-deletado some; só-privada → vazio), o seam `listFollowingIds`
 * (alive-gated) e a rota (`GET /api/feed/following` — anon/desativada → 401, logado → 200, no-store,
 * paginação keyset, cursor permissivo).
 */

/** Semeia uma Receita PÚBLICA da comunidade (dono real) com título pt-BR exibível. Devolve o id. */
async function seedPublicRecipe(
  ownerId: string,
  titulo: string,
  opts?: { origin?: Origin; visibility?: 'public' | 'private' },
): Promise<string> {
  const id = await seedRecipe({
    origin: opts?.origin ?? 'ai_structured',
    originalLocale: 'pt-BR',
    ownerId,
    visibility: opts?.visibility ?? 'public',
    resultKind: 'success',
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

function followingReq(headers?: Headers, query = '') {
  return followingFeedGET(
    new Request(`http://localhost/api/feed/following${query}`, { headers: headers ?? new Headers() }),
  )
}

describe('loadFollowingFeed — filtro por seguidos + gate de pool (#277)', () => {
  it('retorna SÓ as públicas dos seguidos; exclui não-seguidos, privadas, catálogo, removidas, playful', async () => {
    const viewer = await seedUser({ email: 'viewer@following.test' })
    const a = await seedUser({ email: 'cook-a@following.test' })
    const b = await seedUser({ email: 'cook-b@following.test' })
    const c = await seedUser({ email: 'cook-c@following.test' })
    const curator = await seedUser({ email: 'curator@following.test', role: 'curador' })
    const db = getDb()

    // viewer segue A e B; NÃO segue C.
    await follow(db, viewer, a)
    await follow(db, viewer, b)

    const ra = await seedPublicRecipe(a, 'Pública de A') // ✓ aparece
    const raPriv = await seedPublicRecipe(a, 'Privada de A', { visibility: 'private' }) // ✗ privada
    const rb = await seedPublicRecipe(b, 'Pública de B') // ✓ aparece
    const rc = await seedPublicRecipe(c, 'Pública de C (não-seguido)') // ✗ não-seguido
    // Catálogo (owner NULL): nunca casa owner_id IN (seguidos).
    const rcat = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, visibility: 'public', resultKind: 'success' })
    await seedTranslation({ recipeId: rcat, locale: 'pt-BR', titulo: 'Do catálogo', provenance: 'escrita_por_pessoa' })
    // A: pública mas REMOVIDA do pool pela moderação. ✗
    const raRemoved = await seedPublicRecipe(a, 'Removida de A')
    await seedRemovedFromPool({ recipeId: raRemoved, curatorId: curator })
    // A: playful — SEMPRE private (CHECK recipe_playful_private_chk), então some por visibility também;
    // o clause result_kind<>playful é cinto-suspensório herdado do template. ✗
    const raPlayful = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: a, visibility: 'private', resultKind: 'playful' })
    await seedTranslation({ recipeId: raPlayful, locale: 'pt-BR', titulo: 'Zoeira de A', provenance: 'escrita_por_pessoa' })

    const rows = await loadFollowingFeed(db, { viewerId: viewer, requestLocale: 'pt-BR', limit: 20, cursor: null })
    const ids = new Set(rows.map((r) => r.recipe_id))

    expect(ids).toEqual(new Set([ra, rb]))
    // Negativos não-vácuos:
    for (const excluded of [raPriv, rc, rcat, raRemoved, raPlayful]) {
      expect(ids.has(excluded)).toBe(false)
    }
  })

  it('viewer que não segue ninguém → [] (short-circuit, sem ida ao DB)', async () => {
    const viewer = await seedUser({ email: 'lonely@following.test' })
    const rows = await loadFollowingFeed(getDb(), { viewerId: viewer, requestLocale: 'pt-BR', limit: 20, cursor: null })
    expect(rows).toEqual([])
    expect(await listFollowingIds(getDb(), viewer)).toEqual([])
  })

  it('followee SOFT-DELETADO some do feed (alive-gate do listFollowingIds); o vivo permanece', async () => {
    const viewer = await seedUser({ email: 'viewer2@following.test' })
    const dead = await seedUser({ email: 'dead-cook@following.test', deletedAt: new Date() })
    const alive = await seedUser({ email: 'alive-cook@following.test' })
    const db = getDb()
    await follow(db, viewer, dead)
    await follow(db, viewer, alive)
    const rDead = await seedPublicRecipe(dead, 'Pública do desativado')
    const rAlive = await seedPublicRecipe(alive, 'Pública do ativo')

    const ids = new Set((await loadFollowingFeed(db, { viewerId: viewer, requestLocale: 'pt-BR', limit: 20, cursor: null })).map((r) => r.recipe_id))
    expect(ids.has(rAlive)).toBe(true)
    expect(ids.has(rDead)).toBe(false)
    expect(await listFollowingIds(db, viewer)).toEqual([alive])
  })

  it('segue alguém que só tem PRIVADAS → [] (cobre o 2º caso do empty state)', async () => {
    const viewer = await seedUser({ email: 'viewer3@following.test' })
    const a = await seedUser({ email: 'private-only@following.test' })
    const db = getDb()
    await follow(db, viewer, a)
    await seedPublicRecipe(a, 'Só privada', { visibility: 'private' })
    const rows = await loadFollowingFeed(db, { viewerId: viewer, requestLocale: 'pt-BR', limit: 20, cursor: null })
    expect(rows).toEqual([])
  })

  it('web_imported de um seguido, MESMO forçada a public, NÃO aparece (defense-in-depth origin<>web_imported)', async () => {
    const viewer = await seedUser({ email: 'viewer4@following.test' })
    const a = await seedUser({ email: 'importer@following.test' })
    const db = getDb()
    await follow(db, viewer, a)
    const legit = await seedPublicRecipe(a, 'Legítima de A')
    const imported = await seedPublicRecipe(a, 'Importada da web (forçada public)', { origin: 'web_imported' })

    const ids = new Set((await loadFollowingFeed(db, { viewerId: viewer, requestLocale: 'pt-BR', limit: 20, cursor: null })).map((r) => r.recipe_id))
    expect(ids.has(legit)).toBe(true)
    expect(ids.has(imported)).toBe(false)
  })

  it('imagem MODERADA de uma pública: a receita aparece, mas com image_url NULL (gate ri.moderated_at)', async () => {
    const viewer = await seedUser({ email: 'viewer5@following.test' })
    const a = await seedUser({ email: 'cook-img@following.test' })
    const curator = await seedUser({ email: 'curator-img@following.test', role: 'curador' })
    const db = getDb()
    await follow(db, viewer, a)
    const r = await seedPublicRecipe(a, 'Pública com capa moderada')
    await seedRecipeImage({ recipeId: r, moderated: { curatorId: curator } })

    const rows = await loadFollowingFeed(db, { viewerId: viewer, requestLocale: 'pt-BR', limit: 20, cursor: null })
    const row = rows.find((x) => x.recipe_id === r)
    expect(row, 'a receita deve aparecer no feed').toBeDefined()
    expect(row!.image_url).toBeNull() // imagem moderada some do público; a receita continua
  })
})

describe('GET /api/feed/following — rota só-logada (#277)', () => {
  it('anônimo (sem cookie) → 401', async () => {
    const res = await followingReq()
    expect(res.status).toBe(401)
  })

  it('conta desativada → 401', async () => {
    const { headers } = await seedDeletedSessionHeaders({ email: 'deactivated@following.test' })
    const res = await followingReq(headers)
    expect(res.status).toBe(401)
  })

  it('logado → 200 com as públicas dos seguidos + Cache-Control: no-store', async () => {
    const { userId: viewer, headers } = await seedSessionHeaders({ email: 'logged@following.test' })
    const a = await seedUser({ email: 'followed@following.test' })
    await follow(getDb(), viewer, a)
    const r = await seedPublicRecipe(a, 'Receita do seguido')

    const res = await followingReq(headers, '?locale=pt-BR')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as { feed: SearchResult[]; nextCursor: string | null }
    expect(body.feed.map((it) => it.recipeId)).toContain(r)
    // leak-safety: o owner_id cru NUNCA vaza no DTO (só o booleano isOwn).
    expect(body.feed.every((it) => !('owner_id' in it))).toBe(true)
  })

  it('paginação keyset: mais recentes primeiro, sem overlap nem gap, até nextCursor=null', async () => {
    const { userId: viewer, headers } = await seedSessionHeaders({ email: 'paginate@following.test' })
    const a = await seedUser({ email: 'prolific@following.test' })
    await follow(getDb(), viewer, a)
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push(await seedPublicRecipe(a, `Receita ${i}`))

    const res1 = await followingReq(headers, '?locale=pt-BR&limit=2')
    const page1 = (await res1.json()) as { feed: SearchResult[]; nextCursor: string | null }
    expect(page1.feed).toHaveLength(2)
    expect(page1.nextCursor).not.toBeNull()

    const res2 = await followingReq(headers, `?locale=pt-BR&limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`)
    const page2 = (await res2.json()) as { feed: SearchResult[]; nextCursor: string | null }
    expect(page2.feed).toHaveLength(1)
    expect(page2.nextCursor).toBeNull()

    const seen = [...page1.feed, ...page2.feed].map((it) => it.recipeId)
    expect(new Set(seen).size).toBe(3) // sem overlap
    expect(new Set(seen)).toEqual(new Set(ids)) // sem gap
  })

  it('cursor malformado → começo do feed (permissivo, sem 400/500)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'badcursor@following.test' })
    const res = await followingReq(headers, '?locale=pt-BR&cursor=lixo')
    expect(res.status).toBe(200)
  })
})
