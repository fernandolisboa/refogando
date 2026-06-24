import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, report, users } from '@/db/schema'

/**
 * Fila de Reports do Curador (issue #18, AC1) — leitura PURA. Lista os reports `pending`
 * com `origin` e `result_kind` da Receita visíveis (INNER JOIN recipe), ordenados por data
 * de criação (mais antigos primeiro). Espelha `curate/translations/stale` (sem paginação,
 * só metadados; enums em inglês — i18n visível mora na UI #63).
 *
 * Esta é uma VISÃO DE MODERAÇÃO do Curador, não o pool público: pode listar reports de
 * Receitas já removidas (outros pending da mesma Receita). `reporterId` é exposto SÓ ao
 * Curador (a rota é gateada por requireRole 'curador'). Sem corpo de conteúdo da Receita.
 */
export type ReportQueueItem = {
  id: string
  recipeId: string
  reason: string
  origin: string
  resultKind: string
  reporterId: string
  status: string
  createdAt: Date
  /**
   * Dono da Receita reportada (#226) — `null` para Catálogo (receita editorial sem dono). LEFT JOIN
   * users em recipe.owner_id. A UI só oferece a ação "bloquear/desbloquear geração-de-imagem do autor"
   * quando há um dono (Catálogo → sem ação). É o ALVO do `POST .../users/[ownerId]/image-gen-restriction`.
   */
  ownerId: string | null
  /**
   * O dono já está com a geração-de-imagem-por-IA BLOQUEADA pelo Curador (#226)? Alterna o rótulo
   * da ação (bloquear ↔ desbloquear). `false` quando não há dono (Catálogo) ou o dono está liberado.
   * Derivado de `users.image_gen_blocked_at IS NOT NULL` (bloqueado = `at ≠ null`).
   */
  ownerImageGenBlocked: boolean
}

export async function listReportQueue(db: Database): Promise<ReportQueueItem[]> {
  const rows = await db
    .select({
      id: report.id,
      recipeId: report.recipeId,
      reason: report.reason,
      origin: recipe.origin,
      resultKind: recipe.resultKind,
      reporterId: report.reporterId,
      status: report.status,
      createdAt: report.createdAt,
      ownerId: recipe.ownerId,
      // Bloqueado = `image_gen_blocked_at ≠ null`. LEFT JOIN ⇒ `at` é null quando não há dono (Catálogo).
      ownerBlockedAt: users.imageGenBlockedAt,
    })
    .from(report)
    .innerJoin(recipe, eq(recipe.id, report.recipeId))
    // LEFT JOIN: o Catálogo não tem dono (owner_id NULL) — o item ainda aparece, sem ação de bloqueio.
    .leftJoin(users, eq(users.id, recipe.ownerId))
    .where(eq(report.status, 'pending'))
    .orderBy(report.createdAt)

  return rows.map(({ ownerBlockedAt, ...rest }) => ({
    ...rest,
    ownerImageGenBlocked: ownerBlockedAt != null,
  }))
}
