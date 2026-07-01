import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users, userFollow } from '@/db/schema'

/**
 * Seam do grafo de SEGUIR (#274, ADR-0024). Escritas idempotentes (par único pela PK) e leituras
 * PÚBLICAS (contadores/listas) que o perfil anon consome SEM tocar a sessão — o estado "eu sigo?"
 * é separado (`viewerFollows`, exige um viewerId). Soft-deleted (deleted_at) NUNCA aparece: contadores
 * E listas fazem JOIN com `users` + `isNull(deleted_at)` na COUNTERPARTY (o seguidor p/ "seguidores",
 * o seguido p/ "seguindo"), pra contagem e lista SEMPRE concordarem (sem fantasma de conta desativada).
 */

/** Linha PÚBLICA de um Cozinheiro numa lista de seguir — allowlist mínima (sem id/role/email). */
export type FollowUser = { name: string; handle: string; image: string | null }

/** Quantos itens a lista PREVIEW do perfil mostra no v1 — e o TAMANHO DE PÁGINA da lista completa
 * (#307), pra a página 1 do modal ser byte-a-byte o preview. Capa o custo do JOIN e o tamanho do DTO. */
export const FOLLOW_LIST_PREVIEW = 24

/** Uma página da lista completa de seguir (#307): os itens + o cursor opaco da PRÓXIMA página
 * (`null` quando acabou). O cursor é minado de um probe `limit+1` — NUNCA de `items.length < limit`
 * (um soft-delete posterior pode encurtar uma página sem ela ser a última). */
export type FollowListPage = { items: FollowUser[]; nextCursor: string | null }

/** O par keyset por trás do cursor: o `created_at` em TEXTO de precisão-cheia (o JS Date só tem ms ⇒
 * carregar texto e re-parsear `::timestamptz` é lossless) + a uuid da counterparty (desempate). */
type FollowCursor = { ts: string; id: string }

/** UUID canônico — valida o id da counterparty ANTES de bindá-lo `::uuid` (um id forjado daria
 * `invalid input syntax for type uuid` → 500 numa rota anon). */
const CURSOR_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Codifica o cursor (#307): base64url de `${created_at::text}|${counterpartyId}`. O `created_at`
 * vai em TEXTO de precisão-cheia (micros incluídos) — um epoch float ou um `Date.toISOString()` truncaria
 * pra ms e PERDERIA linhas no boundary. O id da counterparty é interno mas sai SÓ aqui, dentro do blob.
 *
 * "Opaco" aqui = OPACO À UI (a UI nunca o desmonta), NÃO confidencial: base64url é trivialmente
 * decodificável, então um cliente curioso lê o `created_at` (micros) e a uuid interna da linha-boundary.
 * Aceitável: o grafo de seguir é PÚBLICO (ADR-0024) e a uuid só serve de keyset (sem alavanca de
 * enumeração além da própria lista pública). Se um dia esses valores precisarem ficar internos,
 * assine/encripte o cursor (HMAC) — sem mudança funcional.
 */
export function encodeFollowCursor({ ts, id }: FollowCursor): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url')
}

/**
 * Decodifica o cursor (#307). Tolerante: qualquer lixo (base64 inválido, sem separador, metade vazia,
 * timestamp não-parseável, id não-uuid) vira `null` ⇒ o chamador trata como PRIMEIRA página, NUNCA lança
 * (a rota é anon e não pode dar 500 por um `?cursor=` adulterado). Parte no PRIMEIRO `|` (o uuid não tem
 * `|`; o texto do timestamp também não). VALIDA o conteúdo (uuid + data parseável) ANTES de devolver, pra
 * um payload estruturalmente-válido-mas-injetável (ex. `x|y`) jamais chegar ao cast `::timestamptz`/`::uuid`.
 */
export function decodeFollowCursor(raw: string): FollowCursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    const sep = decoded.indexOf('|')
    if (sep <= 0) return null // sem separador, ou ts vazio (sep===0)
    const ts = decoded.slice(0, sep)
    const id = decoded.slice(sep + 1)
    if (ts.length === 0 || id.length === 0) return null
    if (!CURSOR_UUID_RE.test(id)) return null // id forjado → primeira página (nunca cast `::uuid` quebrado)
    if (!Number.isFinite(Date.parse(ts))) return null // ts não-data → idem (nunca `::timestamptz` quebrado)
    return { ts, id }
  } catch {
    return null
  }
}

/**
 * Cria a aresta follower→followee (idempotente: re-seguir colide na PK → no-op, sem 23505). Devolve
 * `true` SÓ quando uma aresta NOVA foi de fato inserida — o `.returning()` sob `onConflictDoNothing`
 * vem `[]` no conflito e `[row]` no insert (sinal race-safe pela PK composta). O caller usa isso pra
 * emitir a notificação `new_follower` UMA vez por evento (ADR-0028): re-follow / double-POST não duplica.
 */
export async function follow(
  db: Database,
  followerId: string,
  followeeId: string,
): Promise<boolean> {
  const rows = await db
    .insert(userFollow)
    .values({ followerId, followeeId })
    .onConflictDoNothing()
    .returning({ followerId: userFollow.followerId })
  return rows.length > 0
}

/** Remove a aresta (idempotente: deixar de seguir sem seguir = 0 linhas, sem erro). */
export async function unfollow(db: Database, followerId: string, followeeId: string): Promise<void> {
  await db
    .delete(userFollow)
    .where(and(eq(userFollow.followerId, followerId), eq(userFollow.followeeId, followeeId)))
}

/** `true` se `followerId` segue `followeeId` (lookup por PK — o estado do botão do viewer). */
export async function viewerFollows(
  db: Database,
  followerId: string,
  followeeId: string,
): Promise<boolean> {
  const rows = await db
    .select({ one: sql<number>`1` })
    .from(userFollow)
    .where(and(eq(userFollow.followerId, followerId), eq(userFollow.followeeId, followeeId)))
    .limit(1)
  return rows.length > 0
}

/** Quantos SEGUIDORES VIVOS tem `userId` (gate no FOLLOWER — counterparty — p/ casar com a lista). */
export async function countFollowers(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFollow)
    .innerJoin(users, eq(users.id, userFollow.followerId))
    .where(and(eq(userFollow.followeeId, userId), isNull(users.deletedAt)))
  return row?.count ?? 0
}

/** Quantos `userId` está SEGUINDO (gate no FOLLOWEE — counterparty). */
export async function countFollowing(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userFollow)
    .innerJoin(users, eq(users.id, userFollow.followeeId))
    .where(and(eq(userFollow.followerId, userId), isNull(users.deletedAt)))
  return row?.count ?? 0
}

/** Lista pública (capada) de SEGUIDORES vivos de `userId`, mais recentes primeiro. */
export async function listFollowers(
  db: Database,
  userId: string,
  limit: number,
): Promise<FollowUser[]> {
  return db
    .select({ name: users.name, handle: users.handle, image: users.image })
    .from(userFollow)
    .innerJoin(users, eq(users.id, userFollow.followerId))
    .where(and(eq(userFollow.followeeId, userId), isNull(users.deletedAt)))
    // Desempate determinístico (createdAt pode empatar em bulk/mesmo-ms): o preview capado é estável
    // entre requisições (coerência de cache).
    .orderBy(desc(userFollow.createdAt), asc(userFollow.followerId))
    .limit(limit)
}

/** Lista pública (capada) de quem `userId` SEGUE (vivos), mais recentes primeiro. */
export async function listFollowing(
  db: Database,
  userId: string,
  limit: number,
): Promise<FollowUser[]> {
  return db
    .select({ name: users.name, handle: users.handle, image: users.image })
    .from(userFollow)
    .innerJoin(users, eq(users.id, userFollow.followeeId))
    .where(and(eq(userFollow.followerId, userId), isNull(users.deletedAt)))
    .orderBy(desc(userFollow.createdAt), asc(userFollow.followeeId))
    .limit(limit)
}

/**
 * Lista COMPLETA paginada por cursor (#307). `direction` decide a counterparty: `'followers'` lista os
 * SEGUIDORES (counterparty = followerId, filtra por followeeId = userId) e `'following'` quem o user SEGUE
 * (counterparty = followeeId, filtra por followerId = userId). MESMO gate dos contadores (INNER JOIN
 * `users` + `isNull(deletedAt)` na counterparty) e MESMA ordem do preview (`desc(createdAt)`,
 * `asc(counterparty)`) ⇒ a página 1 é byte-a-byte o preview.
 *
 * KEYSET lossless: o cursor carrega `created_at::text` (precisão-cheia) + a uuid da counterparty; ao
 * decodificar, a cláusula é `(createdAt < ts) OR (createdAt = ts AND counterparty > id)` — a direção
 * `> id` casa o `asc` do desempate sob o `desc(createdAt)`. Busca `limit+1`: se a (limit+1)ª linha existe,
 * fatia-a fora e o `nextCursor` aponta a ÚLTIMA linha MANTIDA; senão `nextCursor = null`. O `cursorTs`
 * (texto do timestamp) e o id da counterparty são SERVER-ONLY — saem só dentro do cursor opaco.
 */
async function listFollowPage(
  db: Database,
  userId: string,
  direction: 'followers' | 'following',
  opts: { cursor?: string | null; limit?: number },
): Promise<FollowListPage> {
  // counterparty = quem aparece na lista; anchor = o lado fixado em `userId`.
  const counterparty = direction === 'followers' ? userFollow.followerId : userFollow.followeeId
  const anchor = direction === 'followers' ? userFollow.followeeId : userFollow.followerId
  const limit = opts.limit ?? FOLLOW_LIST_PREVIEW

  const conditions = [eq(anchor, userId), isNull(users.deletedAt)]
  const decoded = opts.cursor ? decodeFollowCursor(opts.cursor) : null
  if (decoded) {
    // Bind explícito (::timestamptz / ::uuid): o Postgres re-parseia o texto SEM perda; sem o cast um
    // comparativo text/uuid erraria. A coluna crua (não um alias do SELECT) é comparada — válido no WHERE.
    conditions.push(
      sql`(${userFollow.createdAt} < ${decoded.ts}::timestamptz or (${userFollow.createdAt} = ${decoded.ts}::timestamptz and ${counterparty} > ${decoded.id}::uuid))`,
    )
  }

  const rows = await db
    .select({
      name: users.name,
      handle: users.handle,
      image: users.image,
      // SERVER-ONLY (nunca no DTO): alimentam só o cursor opaco da próxima página.
      cursorTs: sql<string>`${userFollow.createdAt}::text`,
      cursorId: counterparty,
    })
    .from(userFollow)
    .innerJoin(users, eq(users.id, counterparty))
    .where(and(...conditions))
    .orderBy(desc(userFollow.createdAt), asc(counterparty))
    .limit(limit + 1) // probe: a (limit+1)ª linha só sinaliza "tem próxima página".

  const hasMore = rows.length > limit
  const kept = hasMore ? rows.slice(0, limit) : rows
  const items: FollowUser[] = kept.map((r) => ({ name: r.name, handle: r.handle, image: r.image }))
  const last = kept[kept.length - 1]
  const nextCursor =
    hasMore && last ? encodeFollowCursor({ ts: last.cursorTs, id: last.cursorId }) : null
  return { items, nextCursor }
}

/** Página da lista COMPLETA de SEGUIDORES vivos de `userId` (#307). Página 1 == preview. */
export function listFollowersPage(
  db: Database,
  userId: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<FollowListPage> {
  return listFollowPage(db, userId, 'followers', opts)
}

/** Página da lista COMPLETA de quem `userId` SEGUE (vivos) (#307). Página 1 == preview. */
export function listFollowingPage(
  db: Database,
  userId: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<FollowListPage> {
  return listFollowPage(db, userId, 'following', opts)
}

/**
 * Ids (SERVER-ONLY) de quem `userId` SEGUE e estão VIVOS — alimenta o filtro do Feed Seguindo
 * (#277). Espelha o gate de `listFollowing` (INNER JOIN `users` + `isNull(deletedAt)` no FOLLOWEE,
 * a counterparty), mas devolve SÓ os ids: o feed os usa como `owner_id IN (...)`. NUNCA serializados
 * ao cliente (o `FollowUser` público segue sem id). SEM `limit` — o feed precisa de TODOS os seguidos
 * (não é preview); SEM `orderBy` — vira filtro `IN`, a ordem é irrelevante (a ordem do feed é por
 * `created_at` da Receita). v1: lista ilimitada aceitável (tabelas minúsculas), mesmo balde do
 * deferimento do índice composto/owner_id do `loadFeed`.
 */
export async function listFollowingIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: userFollow.followeeId })
    .from(userFollow)
    .innerJoin(users, eq(users.id, userFollow.followeeId))
    .where(and(eq(userFollow.followerId, userId), isNull(users.deletedAt)))
  return rows.map((r) => r.id)
}
