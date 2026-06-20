import { eq } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeImage, report } from '@/db/schema'
import { decideModerationReason } from '@/domain/report'

/**
 * Núcleo com efeito da MODERAÇÃO do Curador (issue #18, ADR-0003/0011). Espelha o estilo
 * de `visibility.ts`/`social.ts`: discriminated union que o route mapeia para HTTP.
 *
 * Duas ações sobre um Report pending:
 *  - `applyModerationRemove`: REMOVE a Receita do pool (exclusão LÓGICA via as 3 colunas de
 *    moderação) e resolve o Report. Remover-do-pool é DISTINTO de despublicar: NUNCA toca
 *    `visibility`/`origin` (AC3); a linha privada do Owner permanece (owner ainda lê/gerencia).
 *  - `keepReport`: MANTÉM a Receita no pool e rejeita o Report.
 *
 * #17 (editar→derivada) é DEFERIDO: a ÚNICA escrita em `recipe` aqui são as 3 colunas de
 * moderação — #18 NÃO introduz NENHUM caminho que mute/derive o conteúdo da base (AC5). O
 * "editar receita reportada não-própria ⇒ derivada" fica referenciado a #17 (followup).
 *
 * PROVENIÊNCIA da PRIMEIRA remoção (AC3 rastreabilidade): sob múltiplos reports/Curadores,
 * a 1ª remoção grava quem/quando/por quê; um 2º remove (de outro report) NÃO sobrescreve
 * as colunas de moderação — só resolve o seu próprio report. Os caminhos de saída do pool
 * (moderação vs despublicar) são rastreáveis e independentes.
 */

export type ModerationResult =
  | { kind: 'ok' } //                  200 — removeu/manteve agora
  | { kind: 'ok_already_removed' } //  200 — Receita já estava removida; só resolveu este report
  | { kind: 'not_found' } //           404 — report inexistente
  | { kind: 'invalid_reason' } //      400 — motivo vazio (remove)
  | { kind: 'already_resolved' } //    409 — report já não está pending (anti-corrida)

export async function applyModerationRemove(input: {
  db: Database
  reportId: string // já validado como uuid pelo route
  curatorId: string // session.user.id (route já passou pelo requireRole 'curador')
  reason: string
}): Promise<ModerationResult> {
  const { db, reportId, curatorId, reason } = input

  return db.transaction(async (tx) => {
    // Carrega o report + o estado de moderação ATUAL da Receita-alvo (necessário para
    // preservar a proveniência da 1ª remoção). FOR UPDATE serializa removes concorrentes.
    const [row] = await tx
      .select({
        reportId: report.id,
        status: report.status,
        recipeId: report.recipeId,
        moderationRemovedAt: recipe.moderationRemovedAt,
      })
      .from(report)
      .innerJoin(recipe, eq(recipe.id, report.recipeId))
      .where(eq(report.id, reportId))
      .for('update')
    if (!row) return { kind: 'not_found' as const }
    if (row.status !== 'pending') return { kind: 'already_resolved' as const }

    // Motivo obrigatório (AC2) — após existência/pending, antes de qualquer write.
    if (!decideModerationReason({ reason }).allowed) return { kind: 'invalid_reason' as const }

    const alreadyRemoved = row.moderationRemovedAt != null

    // 1ª remoção: grava a proveniência (quem/quando/por quê). NUNCA toca visibility/origin
    // (AC3) nem conteúdo (AC5). Re-remoção: NÃO sobrescreve (preserva a 1ª).
    if (!alreadyRemoved) {
      await tx
        .update(recipe)
        .set({
          moderationRemovedAt: sql`now()`,
          moderationReason: reason,
          moderatedBy: curatorId,
        })
        .where(eq(recipe.id, row.recipeId))
    }

    // Resolve SÓ este report (outros pending da mesma Receita seguem na fila; fechar-todos
    // é followup). Não toca a Receita aqui.
    await tx
      .update(report)
      .set({ status: 'resolved', resolvedAt: sql`now()`, resolvedBy: curatorId })
      .where(eq(report.id, reportId))

    return alreadyRemoved ? { kind: 'ok_already_removed' as const } : { kind: 'ok' as const }
  })
}

/**
 * MODERAR SÓ A IMAGEM (issue #133, ADR-0016) — o Curador esconde a imagem da Receita reportada SEM
 * derrubar a Receita do pool. Eixo ORTOGONAL a `applyModerationRemove`: NÃO toca
 * `recipe.moderation_*` (a Receita continua no pool); seta `moderated_*` na `recipe_image` apontada
 * por `recipe.image_id`. Como a imagem é COMPARTILHADA (carry-forward), moderá-la a esconde em toda
 * parte. Resolve o report. Preserva a proveniência da 1ª moderação (re-moderar não sobrescreve).
 */
export type ImageModerationResult =
  | { kind: 'ok' } //                  200 — moderou a imagem agora
  | { kind: 'ok_already_moderated' } //200 — imagem já moderada; só resolveu este report
  | { kind: 'not_found' } //           404 — report inexistente
  | { kind: 'invalid_reason' } //      400 — motivo vazio
  | { kind: 'already_resolved' } //    409 — report já não está pending
  | { kind: 'no_image' } //            422 — a Receita reportada não tem imagem a remover

export async function applyImageModeration(input: {
  db: Database
  reportId: string // já validado uuid pelo route
  curatorId: string // session.user.id (route já passou pelo requireRole 'curador')
  reason: string
}): Promise<ImageModerationResult> {
  const { db, reportId, curatorId, reason } = input

  return db.transaction(async (tx) => {
    // Report + a imagem ATUAL da Receita-alvo. FOR UPDATE serializa (innerJoin recipe; NÃO juntar
    // recipe_image aqui — FOR UPDATE no lado nulável de outer join estoura no Postgres).
    const [row] = await tx
      .select({ status: report.status, imageId: recipe.imageId })
      .from(report)
      .innerJoin(recipe, eq(recipe.id, report.recipeId))
      .where(eq(report.id, reportId))
      .for('update')
    if (!row) return { kind: 'not_found' as const }
    if (row.status !== 'pending') return { kind: 'already_resolved' as const }
    if (!decideModerationReason({ reason }).allowed) return { kind: 'invalid_reason' as const }
    if (row.imageId == null) return { kind: 'no_image' as const }

    // Estado atual da imagem (FOR UPDATE, tabela única — sem outer join). Preserva a 1ª moderação.
    const [img] = await tx
      .select({ moderatedAt: recipeImage.moderatedAt })
      .from(recipeImage)
      .where(eq(recipeImage.id, row.imageId))
      .for('update')
    const alreadyModerated = img?.moderatedAt != null

    if (!alreadyModerated) {
      // NUNCA apaga o blob nem zera image_id (ADR-0016): só esconde do público. Owner segue vendo.
      await tx
        .update(recipeImage)
        .set({ moderatedAt: sql`now()`, moderatedReason: reason, moderatedBy: curatorId })
        .where(eq(recipeImage.id, row.imageId))
    }

    // Resolve SÓ este report. A Receita CONTINUA no pool (NÃO toca recipe.moderation_*).
    await tx
      .update(report)
      .set({ status: 'resolved', resolvedAt: sql`now()`, resolvedBy: curatorId })
      .where(eq(report.id, reportId))

    return alreadyModerated ? { kind: 'ok_already_moderated' as const } : { kind: 'ok' as const }
  })
}

export async function keepReport(input: {
  db: Database
  reportId: string
  curatorId: string
}): Promise<ModerationResult> {
  const { db, reportId, curatorId } = input

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: report.status })
      .from(report)
      .where(eq(report.id, reportId))
      .for('update')
    if (!row) return { kind: 'not_found' as const }
    if (row.status !== 'pending') return { kind: 'already_resolved' as const }

    // Mantém a Receita no pool (NÃO toca recipe); só rejeita o report.
    await tx
      .update(report)
      .set({ status: 'rejected', resolvedAt: sql`now()`, resolvedBy: curatorId })
      .where(eq(report.id, reportId))

    return { kind: 'ok' as const }
  })
}
