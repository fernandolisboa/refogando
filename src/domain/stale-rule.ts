/**
 * Regra de obsolescência (stale) — módulo PURO, flag-flip apenas (issue #3, §5).
 *
 * #3 é dona EXCLUSIVA desta regra. Sem embedder, sem I/O, sem re-tradução: só
 * decide QUAIS flags `stale` virar quando campos de um locale mudam.
 *
 *  - Campos TRADUZÍVEIS (titulo/descricao/passos/notas): mudança ⇒ a tradução E o
 *    embedding DAQUELE locale ficam obsoletos.
 *  - Campos INVARIANTES (quantidade/unidade/porcoes/dificuldade): são idênticos
 *    entre locales (não traduzidos) ⇒ mudança NÃO obsoleta tradução nem embedding.
 *
 * `stale` mora só em `recipe_translation` e `recipe_embedding(recipe_id, locale)`,
 * NUNCA na Receita.
 */

/** Campos que existem por-locale (traduzíveis). */
export const TRANSLATABLE_FIELDS = ['titulo', 'descricao', 'passos', 'notas'] as const
export type TranslatableField = (typeof TRANSLATABLE_FIELDS)[number]

/** Campos invariantes entre locales (não traduzidos). */
export const INVARIANT_FIELDS = ['quantidade', 'unidade', 'porcoes', 'dificuldade'] as const
export type InvariantField = (typeof INVARIANT_FIELDS)[number]

/** Nome de campo livre (a entrada é texto cru; não precisa ser conhecido). */
export type ChangedField = string

export type StaleDecision = { staleTranslations: string[]; staleEmbeddings: string[] }

export function isTranslatableField(f: string): f is TranslatableField {
  return (TRANSLATABLE_FIELDS as readonly string[]).includes(f)
}

/**
 * Decide as flags a virar. Se ALGUM campo alterado for traduzível ⇒ aquele locale
 * entra em ambas as listas. Caso contrário (só invariantes) ⇒ ambas vazias.
 */
export function decideStale(input: {
  changedFields: ReadonlyArray<ChangedField>
  locale: string
}): StaleDecision {
  const touchesTranslatable = input.changedFields.some(isTranslatableField)
  if (!touchesTranslatable) return { staleTranslations: [], staleEmbeddings: [] }
  return { staleTranslations: [input.locale], staleEmbeddings: [input.locale] }
}
