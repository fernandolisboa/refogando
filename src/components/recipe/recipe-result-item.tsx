/**
 * Card de UM resultado da Busca (#56). Componente client-safe e PURO (sem hooks de
 * fetch nem de locale): o pai injeta os rótulos já localizados. O card inteiro é um
 * <Link> focável que leva ao detalhe canônico `/recipes/:recipeId` (a #57 implementa a
 * página). Foco visível herda do `:focus-visible` global (#54).
 *
 * - `displayedTitle` vem PRONTO do domínio (original + tradução confiável entre
 *   parênteses) — NÃO pós-processar.
 * - O selo deriva de `origin` via `classifySection` do domínio (NÃO re-deriva a regra), MAS
 *   `isOwn` (a Receita é do viewer, #116/own-label) tem PRECEDÊNCIA: own ⇒ selo "Sua receita".
 * - `autoTranslationSignal === true` → marca discreta (toque leve, não um erro).
 */
import Link from 'next/link'
import { classifySection, type Origin, type SearchSection } from '@/domain/recipe'
import type { RecipeAuthor } from '@/domain/recipe-search-read'
import { Card } from '@/components/ui/card'
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
  /**
   * #116/own-label: a Receita é do viewer (`isOwn` do DTO, derivado server-side de
   * `owner_id === viewerId`). Quando true, o selo vira "Sua receita" (PRECEDE catálogo/
   * comunidade). Default `false` (anônimo, ou item não-próprio). NÃO carrega `owner_id`.
   */
  isOwn?: boolean
  /** Rótulo do selo "Sua receita", já localizado. Lido só quando `isOwn`. */
  ownLabel?: string
  /**
   * Autoria (#129) — `{ name, handle }` PÚBLICOS do dono, do DTO. Quando presente, renderiza o
   * crédito "por <name>" linkando `/u/<handle>` (materializa a Autoria do CONTEXT.md). AUSENTE
   * para Catálogo/sistema (sem dono humano) ⇒ sem byline. NÃO carrega o `owner_id` interno.
   */
  author?: RecipeAuthor
  /** Template "por {name}" já localizado (`busca.porAutor`). Lido só quando há `author`. */
  byLabel?: string
  /**
   * Imagem da receita (#130) — `blob_url` PÚBLICO da thumbnail (do DTO). Quando presente, o card
   * mostra a foto do prato no topo; AUSENTE ⇒ estado limpo (sem thumbnail, sem moldura vazia).
   */
  imageUrl?: string
  /** Imagem gerada por IA (#132)? Mostra o selo "✨ gerada por IA" sobre a thumbnail. */
  imageAiGenerated?: boolean
  /** Rótulo do selo "gerada por IA", já localizado. Lido só quando `imageAiGenerated`. */
  aiLabel?: string
}

export function RecipeResultItem({
  recipeId,
  displayedTitle,
  origin,
  autoTranslationSignal,
  badgeLabels,
  autoTranslationLabel,
  isOwn = false,
  ownLabel,
  author,
  byLabel,
  imageUrl,
  imageAiGenerated = false,
  aiLabel,
}: RecipeResultItemProps) {
  const section = classifySection(origin)
  // #116/own-label: própria do viewer ⇒ selo "Sua receita" (precede catálogo/comunidade).
  const badge = isOwn
    ? { variant: 'minha' as const, label: ownLabel ?? '' }
    : { variant: section, label: badgeLabels[section] }
  // #129/Autoria: o crédito "por <name>". {name} interpolado por replace (folhas i18n são string).
  const byline =
    author !== undefined && byLabel !== undefined
      ? byLabel.replace('{name}', author.name)
      : null
  return (
    <li className="h-full">
      {/* Superfície do card composta via <Card> (ADR-0018): border/bg-card/shadow vêm da
          primitiva; gap-1.5 (sobrepõe o gap-4 padrão do Card), p-4 e o hover de elevação
          continuam aqui. O <li> permanece como item de lista (semântica do <ul> pai). */}
      <Card className="h-full gap-1.5 p-4 transition-shadow duration-150 ease-out hover:shadow-md">
        {/* SEM aria-label: o nome acessível do link é computado do conteúdo (selo de
          proveniência + título + marca de tradução automática) — caso contrário o leitor
          de tela perderia a distinção catálogo/comunidade e o aviso de tradução, que são o
          diferencial informativo desta tela. O byline de Autoria fica FORA deste <Link>
          (link aninhado é HTML inválido) — é um link IRMÃO para o perfil. */}
        <Link
          href={`/recipes/${recipeId}`}
          className="flex flex-col gap-2 rounded-sm focus-visible:outline-none"
        >
          {/* Thumbnail (#130): foto do prato no topo do card. AUSENTE ⇒ estado limpo (sem moldura).
              <img> simples (convenção do repo); alt = título exibido (o card já leva ao detalhe).
              #132: selo "✨ gerada por IA" sobreposto quando ai_generated. */}
          {imageUrl != null && (
            <span className="relative block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt={displayedTitle}
                referrerPolicy="no-referrer"
                className="aspect-video w-full rounded-md border border-border object-cover"
              />
              {imageAiGenerated && aiLabel && (
                <span className="absolute left-1.5 top-1.5 rounded-full border border-border bg-surface/90 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  {aiLabel}
                </span>
              )}
            </span>
          )}
          <ProvenanceBadge variant={badge.variant} label={badge.label} />
          <h3 className="font-display text-lg text-fg">{displayedTitle}</h3>
          {autoTranslationSignal && (
            <span className="text-xs text-muted">{autoTranslationLabel}</span>
          )}
        </Link>
        {/* Autoria (#129): link IRMÃO ao card, levando ao perfil público /u/<handle>. */}
        {byline !== null && author !== undefined && (
          <p className="text-xs text-muted">
            <Link href={`/u/${author.handle}`} className="hover:text-fg hover:underline">
              {byline}
            </Link>
          </p>
        )}
      </Card>
    </li>
  )
}
