import type { Database } from '@/db/client'
import { decideStale } from '@/domain/stale-rule'
import { applyStaleDecision } from '@/server/recipe/stale'
import { embedTranslation } from '@/server/embedding/recompute'

/**
 * Helper edit-time do ciclo da tradução (issue #23, AC6). CABEIA as máquinas existentes:
 * a regra PURA de #3 (`decideStale`: campo traduzível ⇒ aquele locale fica stale; campo
 * invariante ⇒ no-op) → o EFEITO de #14 (`applyStaleDecision`) → o recompute de #14
 * (`embedTranslation`). NÃO re-deriva quando-marcar nem espalha locales.
 *
 * Sequência (sem tx compartilhada — `applyStaleDecision` tem a sua; `embedTranslation`
 * não): marca stale; depois re-embeda SÓ `decision.staleEmbeddings` (o recompute limpa
 * o stale no sucesso). Decisão vazia (só campos invariantes) ⇒ applyStaleDecision no-op ⇒
 * loop vazio ⇒ ZERO re-embed (AC6). #17/#21 reusam este helper.
 */

export async function applyEdit(
  db: Database,
  input: { recipeId: string; locale: string; changedFields: ReadonlyArray<string> },
): Promise<void> {
  const decision = decideStale({ changedFields: input.changedFields, locale: input.locale })
  await applyStaleDecision(db, input.recipeId, decision)
  for (const locale of decision.staleEmbeddings) {
    await embedTranslation(db, input.recipeId, locale)
  }
}
