import { and, eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeVote, recipeFavorite } from '@/db/schema'
import { decideVote } from '@/domain/vote'
import { eligibleForPool } from '@/domain/recipe-pool'

/**
 * Núcleo com efeito de Voto + Favorito (issue #16, ADR-0003). Espelha o estilo de
 * `visibility.ts`: discriminated union que o route mapeia para HTTP — rotas finas e DRY.
 *
 * GATE DE POOL, NÃO de ownership (D3). `applyVisibilityTransition` faz gate de OWNERSHIP
 * (Catálogo → not_found) porque publicar exige ser o dono. Aqui é o OPOSTO: o Catálogo é
 * PÚBLICO e DEVE ser votável/favoritável. O gate replica o gate de LEITURA canônico do
 * GET/search: `(owner_id IS NULL OR visibility='public') AND result_kind <> 'playful'`.
 * Receita privada de outro / playful ⇒ not_found (404, não vaza existência — mesma forma
 * do GET).
 *
 * AC2 (não-autovoto): `applyVote` é o ÚNICO escritor de `recipe_vote` em produção e o
 * único ponto que chama `decideVote`. Como NÃO há CHECK no banco (owner_id é cross-table),
 * qualquer FUTURO segundo escritor de voto DEVE também chamar `decideVote` — senão o AC2
 * fura. Risco residual aceito e documentado (aqui e em `vote.ts`).
 *
 * IDEMPOTÊNCIA (AC1): `INSERT ... ON CONFLICT (user_id, recipe_id) DO NOTHING` (votar 2× =
 * UM voto, sob a PK composta) e `DELETE` (desfazer; no-op se não existe). Vale também sob
 * concorrência (duas chamadas paralelas pela porta de produção colidem no ON CONFLICT).
 */

type Gate = {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
  origin: string // #168: gate de pool exclui web_imported (recipe-pool.ts)
}

export type VoteResult =
  | { kind: 'ok'; voteCount: number; viewerVoted: boolean } // 200
  | { kind: 'not_found' } //                                   404 — inexistente / fora do pool
  | { kind: 'auto_voto' } //                                   422 — votar na própria

export type FavoriteResult =
  | { kind: 'ok'; viewerFavorited: boolean } // 200
  | { kind: 'not_found' } //                    404 — inexistente / fora do pool

/**
 * Gate barato (lê só owner_id + visibility + result_kind) + elegibilidade de POOL.
 * Devolve o `Gate` quando a Receita está no pool (votável/favoritável); `null` quando
 * inexistente OU fora do pool (privada de outro / playful) — o chamador mapeia para 404.
 * MESMO predicado do gate de leitura de `route.ts`/`search.ts` (NÃO o de ownership).
 */
async function loadPoolGate(db: Database, id: string): Promise<Gate | null> {
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      // #18: a dimensão de moderação entra no gate de pool. Removida do pool pelo Curador
      // ⇒ não-votável/favoritável (quem favoritou deixa de ver, igual despublicar, AC3).
      moderationRemovedAt: recipe.moderationRemovedAt,
      // #168: proveniência entra no gate de pool — web_imported nunca é votável/favoritável.
      origin: recipe.origin,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return null // inexistente
  // Elegibilidade de POOL (recipe-pool.ts): Catálogo (owner NULL) OU pública, não-playful, E
  // não-removida por moderação (#18). Fora do pool ⇒ trata como not_found (não vaza
  // existência, espelha o GET).
  return eligibleForPool(gate) ? gate : null
}

/** COUNT(*) de votos da Receita (a Popularidade no detalhe). */
async function countVotes(db: Database, id: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recipeVote)
    .where(eq(recipeVote.recipeId, id))
  return row?.count ?? 0
}

export async function applyVote(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  action: 'vote' | 'unvote'
}): Promise<VoteResult> {
  const { db, id, userId, action } = input

  const gate = await loadPoolGate(db, id)
  if (!gate) return { kind: 'not_found' }

  if (action === 'vote') {
    // Não-autovoto (AC2) — SÓ para votar. owner null (Catálogo) nunca casa.
    const decision = decideVote({ voterId: userId, recipeOwnerId: gate.ownerId })
    if (!decision.allowed) return { kind: 'auto_voto' }

    // Idempotente (AC1): re-votar colide na PK composta ⇒ DO NOTHING.
    await db.insert(recipeVote).values({ userId, recipeId: id }).onConflictDoNothing()
  } else {
    // Desfazer sempre permitido (sem não-autovoto); no-op idempotente se não existe.
    await db
      .delete(recipeVote)
      .where(and(eq(recipeVote.userId, userId), eq(recipeVote.recipeId, id)))
  }

  const voteCount = await countVotes(db, id)
  return { kind: 'ok', voteCount, viewerVoted: action === 'vote' }
}

export async function applyFavorite(input: {
  db: Database
  id: string
  userId: string
  action: 'favorite' | 'unfavorite'
}): Promise<FavoriteResult> {
  const { db, id, userId, action } = input

  const gate = await loadPoolGate(db, id)
  if (!gate) return { kind: 'not_found' }

  // SEM não-autovoto: favoritar a própria Receita é PERMITIDO (favorito é marcador
  // pessoal, não Popularidade).
  if (action === 'favorite') {
    await db.insert(recipeFavorite).values({ userId, recipeId: id }).onConflictDoNothing()
  } else {
    await db
      .delete(recipeFavorite)
      .where(and(eq(recipeFavorite.userId, userId), eq(recipeFavorite.recipeId, id)))
  }

  return { kind: 'ok', viewerFavorited: action === 'favorite' }
}
