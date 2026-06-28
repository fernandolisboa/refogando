'use client'
/**
 * Trilho "Cozinheiros em alta" (#278, ADR-0024 emendado) — coluna à direita da home-Descoberta em telas
 * largas (≥1280px); abaixo disso, seção no FIM do feed. Lista Cozinheiros recomendados por POPULARIDADE
 * GLOBAL, cada CARTÃO com avatar + nome + `@handle · N receitas` + botão Seguir + um preview (1–3) das
 * receitas do Cozinheiro (thumbnail + selo de IA + título serif). Paridade com o protótipo
 * "refogando-3-colunas-telas-maiores" (CreatorCard).
 *
 * APRESENTACIONAL: recebe `cooks` por prop. O fetch + o gate de sessão (Modelo B: nada p/ anon/SSR) +
 * o piso de exibição (`shouldShowRecommendedRail`) vivem no PAI (`SearchExperience` via
 * `useRecommendedCooks`), pra o LAYOUT decidir num único render se abre a 3ª coluna — sem coluna fantasma
 * vazia no caso anon/poucos-cozinheiros. Renderiza `null` quando vazio (defesa; o pai já gateia). FORA de
 * qualquer live region (não é status efêmero). `<h2>` sob o `<h1>` sr-only da `SearchExperience`.
 */
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { Avatar } from '@/components/profile/avatar'
import { CookFollowButton } from './cook-follow-button'
import type { RecommendedCook, RecommendedCookRecipe } from '@/domain/recommended-cooks-read'

export function CooksToFollowRail({ cooks }: { cooks: RecommendedCook[] }) {
  const { messages } = useLocale()
  const m = messages.cozinheirosSugeridos
  // Selo de IA das receitas embutidas reusa o rótulo da Busca (já localizado), p/ disclosure consistente.
  const aiLabel = messages.busca.imagemSeloIa

  // Defesa: o pai só renderiza o trilho quando vai pintar (≥ MIN), mas null-em-vazio evita uma seção órfã.
  if (cooks.length === 0) return null

  return (
    <section aria-labelledby="cooks-to-follow-heading" className="flex flex-col gap-4">
      <h2 id="cooks-to-follow-heading" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>
      <ul className="flex flex-col gap-3">
        {cooks.map((cook) => (
          <li key={cook.handle}>
            <CreatorCard cook={cook} labels={m} aiLabel={aiLabel} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Um cartão de Cozinheiro (CreatorCard do protótipo): cabeçalho (avatar + nome + `@handle · N receitas` +
 * Seguir) e a lista de 1–3 receitas. O cabeçalho (avatar+nome+meta) é UM link pro perfil `/u/<handle>`; o
 * Seguir é IRMÃO (não aninhado no link). As receitas são ESTÁTICAS (como no mock — o cartão é uma amostra,
 * não um índice navegável): thumbnail decorativa + título serif; o selo de IA traz `aiLabel` sr-only.
 */
function CreatorCard({
  cook,
  labels,
  aiLabel,
}: {
  cook: RecommendedCook
  labels: {
    receitaContagem: string
    receitasContagem: string
    seguir: string
    seguindo: string
    erroSeguir: string
  }
  aiLabel: string
}) {
  const countLabel = (cook.recipeCount === 1 ? labels.receitaContagem : labels.receitasContagem).replace(
    '{n}',
    String(cook.recipeCount),
  )
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/u/${cook.handle}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-fg hover:underline"
        >
          {/* alt="" (decorativo): o nome do cozinheiro está ADJACENTE no MESMO link — evita o leitor de
              tela ler o nome duas vezes (mesma lógica do thumbnail da receita abaixo). 42px = mock. */}
          <Avatar src={cook.image} name={cook.name} alt="" size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-1 font-display text-sm font-semibold">{cook.name}</span>
            {/* `@handle · N receitas` numa única linha (spans separados p/ os asserts de contagem). */}
            <span className="line-clamp-1 text-xs text-muted">
              <span>@{cook.handle}</span>
              <span aria-hidden> · </span>
              <span>{countLabel}</span>
            </span>
          </span>
        </Link>
        <CookFollowButton
          handle={cook.handle}
          initialFollowing={false}
          variant="outline"
          className="rounded-full border-brand/50 px-3.5 text-brand-ink hover:border-brand hover:bg-brand/10"
          labels={{ seguir: labels.seguir, seguindo: labels.seguindo, erroSeguir: labels.erroSeguir }}
        />
      </div>
      {cook.recipes.length > 0 && (
        <ul className="flex flex-col">
          {cook.recipes.map((recipe) => (
            <CookRecipeRow key={recipe.recipeId} recipe={recipe} aiLabel={aiLabel} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Uma receita no preview do cartão (estática, espelha o mock): thumbnail 40px (foto ou moldura) com o selo
 * de IA no canto + título serif (até 2 linhas). A thumbnail é DECORATIVA (`alt=""`) — o título adjacente já
 * nomeia a receita (evita leitura dupla no leitor de tela). O selo de IA traz o `aiLabel` como texto
 * sr-only (disclosure de IA — invariante de marca).
 */
function CookRecipeRow({ recipe, aiLabel }: { recipe: RecommendedCookRecipe; aiLabel: string }) {
  return (
    <li className="flex items-center gap-2.5 border-t border-border py-2 first:border-t-0">
      <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-brand/[0.07]">
        {recipe.imageUrl != null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={recipe.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : null}
        {recipe.imageAiGenerated && (
          <span className="absolute bottom-0.5 right-0.5 flex size-3.5 items-center justify-center rounded-full bg-bg text-brand shadow-sm">
            <Sparkles className="size-2.5" strokeWidth={2} aria-hidden />
            <span className="sr-only">{aiLabel}</span>
          </span>
        )}
      </div>
      <span className="line-clamp-2 font-display text-sm font-semibold leading-snug text-fg">
        {recipe.displayedTitle}
      </span>
    </li>
  )
}
