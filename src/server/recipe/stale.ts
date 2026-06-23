import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeTranslation, recipeEmbedding } from '@/db/schema'
import type { StaleDecision } from '@/domain/stale-rule'

/**
 * Aplica as flags de uma `StaleDecision` (issue #3, `decideStale`) ao banco: marca
 * `stale` nas traduções e embeddings dos locales decididos, numa transação. NÃO
 * re-deriva a decisão (a regra de QUANDO marcar é de #3, `stale-rule.ts`); aqui só o
 * EFEITO, espelhando o padrão puro+efeito de `applyVisibilityTransition`
 * (`visibility.ts`). Ponto único onde o cabeamento edit-time de #17/#19/#21 pendura a
 * marcação; o recompute (`embedTranslation`) consome o `stale=true`.
 *
 * Assinatura `(db, recipeId, decision)`: `decideStale` só conhece `locale` — a
 * `StaleDecision` carrega locales, não a Receita — então o `recipeId` vem explícito e
 * vincula os dois UPDATE.
 */
export async function applyStaleDecision(
  db: Database,
  recipeId: string,
  decision: StaleDecision,
): Promise<void> {
  if (decision.staleTranslations.length === 0 && decision.staleEmbeddings.length === 0) return
  await db.transaction(async (tx) => {
    for (const locale of decision.staleTranslations) {
      // Slug CONGELADO (#243, ADR-0020 dec.4): este UPDATE marca só `stale`; o `slug` NUNCA entra
      // no SET — revalidar/re-traduzir não re-deriva a URL canônica. (Igual a curate/edit, owner-edit
      // e a promoção de procedência: nenhum caminho de UPDATE toca o slug.)
      await tx
        .update(recipeTranslation)
        .set({ stale: true })
        .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
    }
    for (const locale of decision.staleEmbeddings) {
      await tx
        .update(recipeEmbedding)
        .set({ stale: true })
        .where(and(eq(recipeEmbedding.recipeId, recipeId), eq(recipeEmbedding.locale, locale)))
    }
  })
}
