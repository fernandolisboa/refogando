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
  sub,
  badgeLabels,
  ownLabel,
  autoTranslationLabel,
  byLabel,
  aiLabel,
  locale,
  results,
}: {
  headingId: string
  heading: string
  /** Subtítulo discreto ao lado do heading (protótipo: "curadas"/"publicadas por pessoas"…). */
  sub?: string
  /** Rótulos de selo por seção, localizados (cada item escolhe pelo seu origin). */
  badgeLabels: BadgeLabels
  /** #116/own-label: rótulo do selo "Sua receita", localizado. Cada item próprio (`result.isOwn`)
   * o exibe no lugar do selo de seção — relevante porque a seção "Minhas" mistura origens. */
  ownLabel: string
  autoTranslationLabel: string
  /** #129/Autoria: template "por {name}" localizado, repassado ao byline de cada item. */
  byLabel: string
  /** #132: rótulo do selo "✨ gerada por IA", localizado, repassado a cada thumbnail ai_generated. */
  aiLabel: string
  /** #231/ADR-0020: locale corrente, repassado a cada item pro link canônico `/{locale}/recipes/…`. */
  locale: string
  results: SearchResult[]
}) {
  if (results.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <h2 id={headingId} className="font-display text-lg font-semibold tracking-tight text-fg">
          {heading}
        </h2>
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
      <ul className="flex flex-col">
        {results.map((result) => (
          <RecipeResultItem
            key={result.recipeId}
            recipeId={result.recipeId}
            locale={locale}
            slug={result.slug}
            displayedTitle={result.displayedTitle}
            origin={result.origin}
            autoTranslationSignal={result.autoTranslationSignal}
            badgeLabels={badgeLabels}
            autoTranslationLabel={autoTranslationLabel}
            isOwn={result.isOwn}
            ownLabel={ownLabel}
            author={result.author}
            byLabel={byLabel}
            imageUrl={result.imageUrl}
            imageAiGenerated={result.imageAiGenerated}
            aiLabel={aiLabel}
          />
        ))}
      </ul>
    </section>
  )
}
