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

/** Quantos itens a lista PREVIEW do perfil mostra no v1 (o contador dá o total; "ver todos" é
 * follow-up). Capa o custo do JOIN no perfil anon e o tamanho do DTO. */
export const FOLLOW_LIST_PREVIEW = 24

/** Cria a aresta follower→followee (idempotente: re-seguir colide na PK → no-op, sem 23505). */
export async function follow(db: Database, followerId: string, followeeId: string): Promise<void> {
  await db.insert(userFollow).values({ followerId, followeeId }).onConflictDoNothing()
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
