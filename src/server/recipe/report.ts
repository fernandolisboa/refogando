import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeReview, report } from '@/db/schema'
import { eligibleForPool } from '@/domain/recipe-pool'
import { decideModerationReason } from '@/domain/report'

/**
 * Núcleo com efeito de Report (issue #18, ADR-0003). Espelha o estilo de `social.ts`:
 * discriminated union que o route mapeia para HTTP — rota fina e DRY.
 *
 * Qualquer Usuário autenticado reporta uma Receita do POOL. O gate é o MESMO de leitura de
 * pool (`eligibleForPool` — gate de pool, NÃO de ownership): só se reporta o que está visível
 * no pool. Fora do pool (privada de outro / playful / removida / inexistente)
 * ⇒ not_found (404, não vaza existência — coerente com o GET por uuid).
 *
 * O Report mira a RECEITA (recipe_id), não a tradução: a moderação tem identidade única
 * entre locales (AC4). Múltiplos reports por Receita são permitidos (a fila agrega; dedup
 * por (recipe,reporter) é followup, não-AC). Self-report (dono reporta a PRÓPRIA pública)
 * é permitido (própria pública está no pool ⇒ 201) — aceitável no v1.
 */

type Gate = {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
  origin: string // #168: gate de pool exclui web_imported (recipe-pool.ts)
}

export type ReportResult =
  | { kind: 'ok'; reportId: string } // 201
  | { kind: 'not_found' } //            404 — inexistente / fora do pool
  | { kind: 'invalid_reason' } //       400 — motivo vazio

/**
 * Gate barato + elegibilidade de POOL (lê owner_id + visibility + result_kind +
 * moderation_removed_at). Devolve o `Gate` quando a Receita está no pool; `null` quando
 * inexistente OU fora do pool. MESMO predicado `eligibleForPool` (recipe-pool.ts).
 */
async function loadPoolGate(db: Database, id: string): Promise<Gate | null> {
  const [gate] = await db
    .select({
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      origin: recipe.origin, // #168: gate de pool exclui web_imported (recipe-pool.ts)
      curationStatus: recipe.curationStatus, // #238: rascunho de catálogo não-aprovado não é pool
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  if (!gate) return null
  return eligibleForPool(gate) ? gate : null
}

export async function createReport(input: {
  db: Database
  id: string // já validado como uuid pelo route
  userId: string // session.user.id (route já passou pelo requireSession)
  reason: string
}): Promise<ReportResult> {
  const { db, id, userId, reason } = input

  // Gate de pool ANTES de validar o motivo: receita fora do pool ⇒ 404 leak-safe,
  // sem revelar se o motivo seria válido (não vaza existência).
  const gate = await loadPoolGate(db, id)
  if (!gate) return { kind: 'not_found' }

  // Motivo obrigatório (AC2 — mesmo validador puro de remover-do-pool).
  if (!decideModerationReason({ reason }).allowed) return { kind: 'invalid_reason' }

  const [row] = await db
    .insert(report)
    .values({ recipeId: id, reporterId: userId, reason })
    .returning({ id: report.id })

  return { kind: 'ok', reportId: row.id }
}

export type ReviewReportResult =
  | { kind: 'ok'; reportId: string } // 201
  | { kind: 'not_found' } //            404 — inexistente / fora do pool / já moderada
  | { kind: 'invalid_reason' } //       400 — motivo vazio

/**
 * Núcleo com efeito de Report de uma AVALIAÇÃO (issue #366, ADR-0027). Espelha `createReport`:
 * gate de POOL leak-safe ANTES do motivo, motivo obrigatório, INSERT na fila (agora com `review_id`).
 *
 * O gate mira a RECEITA DONA da avaliação (`eligibleForPool`, fonte única): só se reporta avaliação de
 * receita visível no pool — fora dele ⇒ 404, sem vazar existência. E a avaliação JÁ MODERADA ⇒ 404 (M5:
 * conteúdo já-oculto não gera ruído de pendências, e o oráculo 201-vs-404 fica fechado). Auto-report da
 * própria avaliação é PERMITIDO/harmless (AC "qualquer usuário").
 */
export async function createReviewReport(input: {
  db: Database
  reviewId: string // já validado como uuid pelo route
  reporterId: string // session.user.id (route já passou pelo requireSession)
  reason: string
}): Promise<ReviewReportResult> {
  const { db, reviewId, reporterId, reason } = input

  // A avaliação + o gate de pool da receita dona, numa query. `!row` = avaliação inexistente.
  const [row] = await db
    .select({
      moderatedAt: recipeReview.moderatedAt,
      ownerId: recipe.ownerId,
      visibility: recipe.visibility,
      resultKind: recipe.resultKind,
      moderationRemovedAt: recipe.moderationRemovedAt,
      origin: recipe.origin,
      curationStatus: recipe.curationStatus,
    })
    .from(recipeReview)
    .innerJoin(recipe, eq(recipe.id, recipeReview.recipeId))
    .where(eq(recipeReview.id, reviewId))
  if (!row) return { kind: 'not_found' }
  // M5: avaliação já moderada ⇒ 404 (não reporta conteúdo já-oculto).
  if (row.moderatedAt != null) return { kind: 'not_found' }
  // Gate de pool leak-safe ANTES do motivo (receita fora do pool ⇒ 404, sem revelar validade do motivo).
  if (!eligibleForPool(row)) return { kind: 'not_found' }

  if (!decideModerationReason({ reason }).allowed) return { kind: 'invalid_reason' }

  const [inserted] = await db
    .insert(report)
    .values({ reviewId, reporterId, reason })
    .returning({ id: report.id })

  return { kind: 'ok', reportId: inserted.id }
}
