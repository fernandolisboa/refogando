import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeReview, users } from '@/db/schema'
import { decideReview } from '@/domain/review'
import { eligibleForPool } from '@/domain/recipe-pool'
import type { CurationStatus } from '@/domain/recipe-curation'

/**
 * Núcleo com efeito da AVALIAÇÃO (issue #363, ADR-0027). Espelha `social.ts`: discriminated
 * unions que o route mapeia para HTTP — rotas finas e DRY.
 *
 * GATE DE POOL, NÃO de ownership (como voto/favorito): o Catálogo é PÚBLICO e DEVE ser
 * avaliável. O gate (`loadReviewGate`) replica o gate de LEITURA canônico do GET/search via
 * `eligibleForPool` (fonte única) — receita privada de outro/playful/web_imported/rascunho de
 * catálogo ⇒ not_found (404, não vaza existência). O gate DISPARA ANTES de qualquer checagem
 * de nota/auto-avaliação/comentário, pra o erro nunca revelar existência por um código distinto.
 *
 * AC (auto-avaliação): `applyReview` é o ÚNICO escritor de `recipe_review` e o único a chamar
 * `decideReview`. Como NÃO há CHECK no banco (owner_id é cross-table), qualquer FUTURO segundo
 * escritor (ex.: o emit da notificação #371) DEVE também chamar `decideReview`.
 *
 * UNICIDADE (1 por par): `INSERT ... ON CONFLICT (user_id, recipe_id) DO UPDATE` — re-avaliar
 * EDITA a linha (nota/comentário novos), inclusive sob concorrência (colidem na UNIQUE).
 *
 * MÉDIA/CONTAGEM (`loadAggregate`): agregado CRU (NÃO Bayesiano — isso é #368) sobre as linhas
 * VIVAS (autor não soft-deletado + `moderated_at IS NULL`). `avg(...)::float8` é OBRIGATÓRIO:
 * postgres-js devolve `numeric`/`avg` como STRING (todo agregado do repo casta); float8
 * preserva NULL-em-zero-linhas ⇒ `average: number | null` se mantém.
 */

type Gate = {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
  origin: string
  // eligibleForPool EXIGE curationStatus (#238) — sem ele o gate não tipa.
  curationStatus: CurationStatus
}

/** Linha PÚBLICA de uma Avaliação — allowlist mínima (sem user_id/moderated_at/ids internos). */
export type ReviewView = {
  id: string
  rating: number
  comment: string | null
  author: { name: string | null; handle: string | null }
  createdAt: Date
}

export type ReviewResult =
  | {
      kind: 'ok'
      average: number | null
      count: number
      viewerRating: number | null
      viewerComment: string | null
    } // 200
  | { kind: 'not_found' } //       404 — inexistente / fora do pool
  | { kind: 'auto_review' } //     422 — avaliar a própria
  | { kind: 'invalid_rating' } //  400
  | { kind: 'invalid_comment' } // 400

/**
 * Gate barato + elegibilidade de POOL — devolve o `Gate` quando a Receita está no pool
 * (avaliável); `null` quando inexistente OU fora do pool. Cópia VERBATIM de `social.ts
 * loadPoolGate` (não importado de lá pra evitar contenção com a fatia #362). MESMO predicado
 * (`eligibleForPool`), fonte única compartilhada.
 */
async function loadReviewGate(db: Database, id: string): Promise<Gate | null> {
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      origin: recipe.origin,
      curationStatus: recipe.curationStatus,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return null
  return eligibleForPool(gate) ? gate : null
}

/**
 * Média (crua) + contagem das Avaliações VIVAS da Receita. INNER JOIN `users` +
 * `isNull(deletedAt)` exclui autores desativados do agregado E da lista (todo read social
 * público filtra `deleted_at`); `moderated_at IS NULL` aplica o seam de moderação (#366).
 * `avg(...)::float8` → número real (NULL em zero linhas); `count(*)::int` → número (não string).
 */
async function loadAggregate(
  db: Database,
  id: string,
): Promise<{ average: number | null; count: number }> {
  const [row] = await db
    .select({
      average: sql<number | null>`avg(${recipeReview.rating})::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(recipeReview)
    .innerJoin(users, eq(users.id, recipeReview.userId))
    .where(
      and(
        eq(recipeReview.recipeId, id),
        isNull(recipeReview.moderatedAt),
        isNull(users.deletedAt),
      ),
    )
  return { average: row?.average ?? null, count: row?.count ?? 0 }
}

export async function applyReview(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  action: 'save' | 'delete'
  rating?: number
  comment?: unknown
}): Promise<ReviewResult> {
  const { db, id, userId, action } = input

  const gate = await loadReviewGate(db, id)
  if (!gate) return { kind: 'not_found' }

  if (action === 'save') {
    const d = decideReview({
      reviewerId: userId,
      recipeOwnerId: gate.ownerId,
      rating: input.rating ?? NaN,
      comment: input.comment,
    })
    if (!d.allowed) return { kind: d.reason }

    // Upsert com o comentário NORMALIZADO — 1 por (user, receita) via UNIQUE (edita sob conflito).
    await db
      .insert(recipeReview)
      .values({ userId, recipeId: id, rating: input.rating!, comment: d.comment })
      .onConflictDoUpdate({
        target: [recipeReview.userId, recipeReview.recipeId],
        set: { rating: input.rating!, comment: d.comment, updatedAt: sql`now()` },
      })

    const agg = await loadAggregate(db, id)
    return { kind: 'ok', ...agg, viewerRating: input.rating!, viewerComment: d.comment }
  }

  // delete: sem checagem de nota/auto/comentário; idempotente (no-op se não existe). Ainda
  // pool-gated (fora do pool ⇒ 404), consistente com `unvote` — as avaliações PERSISTEM
  // através de despublicar (o gate 404 nesse caso é intencional, não apaga a linha).
  await db
    .delete(recipeReview)
    .where(and(eq(recipeReview.userId, userId), eq(recipeReview.recipeId, id)))
  const agg = await loadAggregate(db, id)
  return { kind: 'ok', ...agg, viewerRating: null, viewerComment: null }
}

/** Cap SERVER-controlled da lista (paginação por cursor deferida). Protege o payload SSR/GET. */
const REVIEW_LIST_LIMIT = 50

/**
 * Leitura COOKIE-FREE do agregado + lista de Avaliações — SEM dado do viewer. Devolve `null`
 * quando fora do pool (chama `loadReviewGate` ⇒ doubles como gate leak-safe: o caller 404 sem
 * uma segunda query). O agregado é o VERDADEIRO (sobre TODAS as linhas vivas, sem LIMIT); a
 * lista é capada em `REVIEW_LIST_LIMIT`. `average` é a MÉDIA crua (NÃO Bayesiano — isso é #368).
 */
export async function loadRecipeReviews(
  db: Database,
  { id }: { id: string },
): Promise<{ average: number | null; count: number; reviews: ReviewView[] } | null> {
  const gate = await loadReviewGate(db, id)
  if (!gate) return null

  const agg = await loadAggregate(db, id)
  const rows = await db
    .select({
      id: recipeReview.id,
      rating: recipeReview.rating,
      comment: recipeReview.comment,
      authorName: users.name,
      authorHandle: users.handle,
      createdAt: recipeReview.createdAt,
    })
    .from(recipeReview)
    .innerJoin(users, eq(users.id, recipeReview.userId))
    .where(and(eq(recipeReview.recipeId, id), isNull(recipeReview.moderatedAt), isNull(users.deletedAt)))
    .orderBy(desc(recipeReview.createdAt))
    .limit(REVIEW_LIST_LIMIT)

  const reviews: ReviewView[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    author: { name: r.authorName, handle: r.authorHandle },
    createdAt: r.createdAt,
  }))
  return { average: agg.average, count: agg.count, reviews }
}

export type ViewerReviewResult =
  | {
      kind: 'ok'
      viewerReview: { rating: number; comment: string | null } | null
      isOwner: boolean
    }
  | { kind: 'not_found' } // 404 — inexistente / fora do pool (leak-safe)

/**
 * Estado da PRÓPRIA Avaliação do viewer — leitura per-viewer que o caminho PÚBLICO/cacheável
 * do detalhe (lê anônimo, sem cookie) não entrega. MESMO gate leak-safe (404 fora do pool).
 * `userId` é HARD-WIRED da sessão (anti-IDOR — nunca de query/body); nunca vaza a avaliação
 * alheia. `isOwner` deixa a UI esconder o widget do dono (auto-avaliação barrada).
 */
export async function loadViewerReview(
  db: Database,
  { id, userId }: { id: string; userId: string },
): Promise<ViewerReviewResult> {
  const gate = await loadReviewGate(db, id)
  if (!gate) return { kind: 'not_found' }

  const [row] = await db
    .select({ rating: recipeReview.rating, comment: recipeReview.comment })
    .from(recipeReview)
    .where(and(eq(recipeReview.userId, userId), eq(recipeReview.recipeId, id)))
    .limit(1)

  return {
    kind: 'ok',
    viewerReview: row ? { rating: row.rating, comment: row.comment } : null,
    isOwner: gate.ownerId === userId,
  }
}
