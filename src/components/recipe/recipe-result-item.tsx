/**
 * Item de UM resultado da Busca/Feed (#56) — LINHA editorial (protótipo RefoStage): kicker de
 * proveniência + título grande à esquerda, thumbnail (foto ou placeholder) à direita. Componente
 * client-safe e PURO (sem hooks de fetch/locale): o pai injeta os rótulos já localizados.
 *
 * - `displayedTitle` vem PRONTO do domínio (original + tradução confiável) — NÃO pós-processar.
 * - O KICKER deriva de `origin` via `classifySection` (NÃO re-deriva a regra), MAS `isOwn`
 *   (#116) tem PRECEDÊNCIA: own ⇒ "Sua receita" em tinta de marca. Proveniência SEMPRE visível
 *   (texto colorido em vez do selo-pílula nas listas, como no protótipo) — catálogo=erva,
 *   comunidade=neutro, minha=páprica. `autoTranslationSignal` entra no kicker (toque leve).
 * - Thumbnail (#130): foto quando há `imageUrl`; senão um placeholder (ausente ≠ vazio na FOTO,
 *   mas o protótipo mostra sempre a moldura). Selo "✨ gerada por IA" (#132) sobre a foto gerada.
 */
import Link from 'next/link'
import { Image as ImageIcon } from 'lucide-react'
import { classifySection, type Origin, type SearchSection } from '@/domain/recipe'
import type { RecipeAuthor } from '@/domain/recipe-search-read'
import { recipeDetailPath } from '@/domain/recipe-detail-route'
import { cn } from '@/lib/utils'

/** Rótulos de selo por seção, já localizados. O item escolhe pelo seu próprio
 * `origin` (via `classifySection`) — necessário porque "Talvez você queira" mistura
 * origens (catalog e comunidade no mesmo bloco). */
export type BadgeLabels = Record<SearchSection, string>

export type RecipeResultItemProps = {
  recipeId: string
  /**
   * Locale CORRENTE (#231, ADR-0020) — o segmento `[locale]` do link canônico `/{locale}/recipes/…`.
   * Obrigatório: o pai (server por segmento `[locale]`, ou client via `useLocale()`) sempre o conhece.
   */
  locale: string
  /**
   * Slug do locale corrente (#231) — quando presente, o card linka `/{locale}/recipes/<slug>`
   * (canônico). AUSENTE ⇒ fallback `/{locale}/recipes/<uuid>` (que 308a pro slug). NUNCA link nu.
   */
  slug?: string
  displayedTitle: string
  origin: Origin
  autoTranslationSignal: boolean
  badgeLabels: BadgeLabels
  /** Rótulo da marca de tradução automática, já localizado. */
  autoTranslationLabel: string
  /**
   * #116/own-label: a Receita é do viewer (`isOwn` do DTO). Quando true, o kicker vira
   * "Sua receita" (PRECEDE catálogo/comunidade). Default `false`.
   */
  isOwn?: boolean
  /** Rótulo do selo "Sua receita", já localizado. Lido só quando `isOwn`. */
  ownLabel?: string
  /**
   * Autoria (#129) — `{ name, handle }` PÚBLICOS do dono. Quando presente, renderiza o crédito
   * "por <name>" linkando `/u/<handle>` (link IRMÃO, fora do link do card). AUSENTE p/ Catálogo.
   */
  author?: RecipeAuthor
  /** Template "por {name}" já localizado (`busca.porAutor`). Lido só quando há `author`. */
  byLabel?: string
  /** Imagem da receita (#130) — `blob_url` PÚBLICO da thumbnail. */
  imageUrl?: string
  /** Imagem gerada por IA (#132)? Mostra o selo "✨ gerada por IA" sobre a thumbnail. */
  imageAiGenerated?: boolean
  /** Rótulo do selo "gerada por IA", já localizado. Lido só quando `imageAiGenerated`. */
  aiLabel?: string
}

export function RecipeResultItem({
  recipeId,
  locale,
  slug,
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
  // Kicker de proveniência: own ⇒ "Sua receita" (páprica); senão o selo da seção
  // (catálogo=erva, comunidade=neutro). Tradução automática entra como sufixo do kicker.
  const kickerLabel = isOwn ? (ownLabel ?? '') : badgeLabels[section]
  const kickerColor = isOwn
    ? 'text-brand-ink'
    : section === 'catalogo'
      ? 'text-accent-strong'
      : 'text-muted'
  const kicker = autoTranslationSignal ? `${kickerLabel} · ${autoTranslationLabel}` : kickerLabel
  // #129/Autoria: "por <name>". {name} interpolado por replace (folhas i18n são string).
  const byline =
    author !== undefined && byLabel !== undefined ? byLabel.replace('{name}', author.name) : null
  // #231 (ADR-0020): link canônico `/{locale}/recipes/<slug>` no locale corrente; sem slug naquele
  // locale, cai no fallback `/{locale}/recipes/<uuid>` (que 308a pro slug) — NUNCA link nu sem locale.
  const detailHref = recipeDetailPath(locale, slug ?? recipeId)

  return (
    <li className="flex items-center gap-4 border-t border-border py-4 first:border-t-0">
      <div className="min-w-0 flex-1">
        {/* O título é o link primário pro detalhe; foco visível herda do :focus-visible global. */}
        <Link href={detailHref} className="group block rounded-sm">
          {kickerLabel.length > 0 && (
            <div className={cn('mb-1 text-xs font-semibold tracking-wide', kickerColor)}>
              {kicker}
            </div>
          )}
          <h3 className="font-display text-xl font-semibold leading-tight text-fg transition-colors group-hover:text-brand-ink sm:text-2xl">
            {displayedTitle}
          </h3>
        </Link>
        {/* Autoria (#129): link IRMÃO ao perfil público /u/<handle>. */}
        {byline !== null && author !== undefined && (
          <p className="mt-1 text-sm text-muted">
            <Link href={`/u/${author.handle}`} className="hover:text-fg hover:underline">
              {byline}
            </Link>
          </p>
        )}
      </div>
      {/* #5 (Direção C): thumbnail PAISAGEM à direita (foto ou placeholder), com o selo de IA sobreposto.
          Aspecto 3:2 + um pouco mais larga (152px no mock) p/ a linha editorial respirar. */}
      <div className="relative w-32 flex-none sm:w-36">
        {imageUrl != null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={displayedTitle}
            referrerPolicy="no-referrer"
            // #462: feed infinito (Descoberta/Busca/Seguindo) — thumb abaixo da dobra só baixa ao chegar
            // perto da viewport (economia de banda; espelha review-section/moderation-queue).
            loading="lazy"
            className="aspect-[3/2] w-full rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex aspect-[3/2] w-full items-center justify-center rounded-lg border border-border bg-brand/[0.07] text-brand/40">
            <ImageIcon className="size-5" strokeWidth={1.5} aria-hidden />
          </div>
        )}
        {/* Selo "gerada por IA": pílula BRANCA com sombra leve e tinta escura (protótipo Direção C). */}
        {imageAiGenerated && aiLabel && (
          <span className="absolute left-2 top-2 rounded-full bg-bg px-2 py-0.5 text-[0.65rem] font-medium text-fg shadow-sm">
            {aiLabel}
          </span>
        )}
      </div>
    </li>
  )
}
