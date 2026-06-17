/**
 * Card de UM resultado da Busca (#56). Componente client-safe e PURO (sem hooks de
 * fetch nem de locale): o pai injeta os rótulos já localizados. O card inteiro é um
 * <Link> focável que leva ao detalhe canônico `/recipes/:recipeId` (a #57 implementa a
 * página). Foco visível herda do `:focus-visible` global (#54).
 *
 * - `displayedTitle` vem PRONTO do domínio (original + tradução confiável entre
 *   parênteses) — NÃO pós-processar.
 * - O selo deriva de `origin` via `classifySection` do domínio (NÃO re-deriva a regra).
 * - `autoTranslationSignal === true` → marca discreta (toque leve, não um erro).
 */
import Link from 'next/link'
import { classifySection, type Origin, type SearchSection } from '@/domain/recipe'
import { ProvenanceBadge } from './provenance-badge'

/** Rótulos de selo por seção, já localizados. O item escolhe pelo seu próprio
 * `origin` (via `classifySection`) — necessário porque "Talvez você queira" mistura
 * origens (catalog e comunidade no mesmo bloco). */
export type BadgeLabels = Record<SearchSection, string>

export type RecipeResultItemProps = {
  recipeId: string
  displayedTitle: string
  origin: Origin
  autoTranslationSignal: boolean
  badgeLabels: BadgeLabels
  /** Rótulo da marca de tradução automática, já localizado. */
  autoTranslationLabel: string
}

export function RecipeResultItem({
  recipeId,
  displayedTitle,
  origin,
  autoTranslationSignal,
  badgeLabels,
  autoTranslationLabel,
}: RecipeResultItemProps) {
  const section = classifySection(origin)
  return (
    <li>
      {/* SEM aria-label: o nome acessível do link é computado do conteúdo (selo de
          proveniência + título + marca de tradução automática) — caso contrário o leitor
          de tela perderia a distinção catálogo/comunidade e o aviso de tradução, que são o
          diferencial informativo desta tela. */}
      <Link
        href={`/recipes/${recipeId}`}
        className="flex h-full flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-sm transition-shadow duration-150 ease-out hover:shadow-md"
      >
        <ProvenanceBadge section={section} label={badgeLabels[section]} />
        <h3 className="font-display text-lg text-fg">{displayedTitle}</h3>
        {autoTranslationSignal && (
          <span className="text-xs text-muted">{autoTranslationLabel}</span>
        )}
      </Link>
    </li>
  )
}
