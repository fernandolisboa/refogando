import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeReview, users } from '@/db/schema'

/**
 * `C` global da Bayesiana de popularidade (issue #368, ADR-0027/0028) — a MÉDIA GLOBAL das notas VIVAS,
 * o prior pra onde a nota de cada receita/cozinheiro é encolhida (shrinkage por confiança-de-volume).
 *
 * VIVAS = autor não soft-deletado (`INNER JOIN users + deleted_at IS NULL`) + `moderated_at IS NULL`.
 * ISSO CASA EXATAMENTE `loadAggregate`/`loadRecipeReviews` (review.ts) e os agregados de rating do
 * ranking (search.ts/recommended-cooks.ts) — o mesmo universo de linhas em toda leitura de nota, pra o
 * prior não divergir do que compõe a própria média por-receita.
 *
 * MÓDULO SERVER SEPARADO (não `review.ts`): evita colisão de merge com o #374. `avg(...)::float8` é
 * OBRIGATÓRIO (postgres-js devolve `avg`/`numeric` como STRING; float8 preserva NULL-em-zero-linhas).
 *
 * FALLBACK EM TS (o caller): `const C = (await loadGlobalRatingAverage(db)) ?? 3.0` — bindado no SQL
 * como `::float8`, NUNCA como NULL. Bindar NULL faria o `CASE ... ELSE C` render NULL, e sob `DESC` o
 * Postgres põe NULLS FIRST ⇒ toda receita de 0-nota subiria ao topo (quebraria o guarda-corpo (b)).
 * Por isso o fallback é um número real, resolvido em TS. Computado 1× por passo de ranking (per-request;
 * cache cross-request DEFERIDO — o custo é um agregado sobre uma tabela pequena).
 */
export async function loadGlobalRatingAverage(db: Database): Promise<number | null> {
  const [row] = await db
    .select({ c: sql<number | null>`avg(${recipeReview.rating})::float8` })
    .from(recipeReview)
    .innerJoin(users, eq(users.id, recipeReview.userId))
    .where(and(isNull(recipeReview.moderatedAt), isNull(users.deletedAt)))
  return row?.c ?? null
}
