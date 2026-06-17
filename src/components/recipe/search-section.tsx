/**
 * Uma seção rotulada de resultados da Busca (#56): Catálogo, Comunidade OU "Talvez
 * você queira". `<section aria-labelledby>` + `<h2 id>` + `<ul>` de RecipeResultItem.
 *
 * GUARDA DE SEÇÃO VAZIA (fonte de verdade): se `results` estiver vazio, RETORNA `null`
 * — sem heading órfão nem `aria-labelledby` apontando para título sem conteúdo (defeito
 * de a11y/hierarquia). A API SEMPRE devolve ambas as chaves `{catalogo, comunidade}` e é
 * comum um lado vir vazio; o pai TAMBÉM só monta seções não-vazias (guarda dupla).
 *
 * PRESERVA a ordem do array (a API já ordenou — NÃO re-ordenar). Grid mobile-first 1→2→3.
 */
import { RecipeResultItem, type BadgeLabels } from './recipe-result-item'
import type { SearchResult } from '@/domain/recipe-search-read'

export function SearchSection({
  headingId,
  heading,
  badgeLabels,
  autoTranslationLabel,
  results,
}: {
  headingId: string
  heading: string
  /** Rótulos de selo por seção, localizados (cada item escolhe pelo seu origin). */
  badgeLabels: BadgeLabels
  autoTranslationLabel: string
  results: SearchResult[]
}) {
  if (results.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-display text-xl text-fg">
        {heading}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((result) => (
          <RecipeResultItem
            key={result.recipeId}
            recipeId={result.recipeId}
            displayedTitle={result.displayedTitle}
            origin={result.origin}
            autoTranslationSignal={result.autoTranslationSignal}
            badgeLabels={badgeLabels}
            autoTranslationLabel={autoTranslationLabel}
          />
        ))}
      </ul>
    </section>
  )
}
