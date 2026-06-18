import { eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, report } from '@/db/schema'

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
}

export async function listReportQueue(db: Database): Promise<ReportQueueItem[]> {
  return db
    .select({
      id: report.id,
      recipeId: report.recipeId,
      reason: report.reason,
      origin: recipe.origin,
      resultKind: recipe.resultKind,
      reporterId: report.reporterId,
      status: report.status,
      createdAt: report.createdAt,
    })
    .from(report)
    .innerJoin(recipe, eq(recipe.id, report.recipeId))
    .where(eq(report.status, 'pending'))
    .orderBy(report.createdAt)
}
