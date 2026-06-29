'use client'
/**
 * Cartão de Cozinheiro (#308) — extraído do `CreatorCard` do trilho (#278) pra ser REUSADO pelo trilho
 * "Cozinheiros em alta" E pela Descoberta de Cozinheiros dedicada (`/cooks`). Cabeçalho (avatar + nome +
 * `@handle [· N receitas]` + Seguir) e um preview OPCIONAL de receitas.
 *
 * Dois modos de dados: RECOMENDAÇÃO traz `recipeCount` + `recipes` (preview rico); BUSCA traz só
 * `{name,handle,image}` (degrada: sem contagem, sem preview). Ambos casam `CookCardCook` (campos extra
 * opcionais).
 *
 * `authed`: logado → `CookFollowButton` inline (otimista, #278); anônimo → "Seguir" vira um LINK pro
 * sign-in com `?returnTo=` (preserva a intenção — volta à página após login, guarda anti open-redirect).
 * O trilho é só-logado (Modelo B), então usa o default `authed=true`.
 */
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Avatar } from '@/components/profile/avatar'
import { CookFollowButton } from './cook-follow-button'
import type { RecommendedCookRecipe } from '@/domain/recommended-cooks-read'

export type CookCardCook = {
  name: string
  handle: string
  image: string | null
  /** Só na RECOMENDAÇÃO (preview rico); ausente na BUSCA. */
  recipeCount?: number
  recipes?: RecommendedCookRecipe[]
}

export type CookCardLabels = {
  receitaContagem: string
  receitasContagem: string
  seguir: string
  seguindo: string
  erroSeguir: string
}

const FOLLOW_BTN_CLASS =
  'rounded-full border-brand/50 px-3.5 text-brand-ink hover:border-brand hover:bg-brand/10'

export function CookCard({
  cook,
  labels,
  aiLabel,
  authed = true,
  returnTo = '/cooks',
}: {
  cook: CookCardCook
  labels: CookCardLabels
  /** Rótulo sr-only do selo de IA das receitas embutidas. */
  aiLabel: string
  authed?: boolean
  /** Caminho interno pra onde voltar após o sign-in (anon). */
  returnTo?: string
}) {
  const countLabel =
    cook.recipeCount === undefined
      ? null
      : (cook.recipeCount === 1 ? labels.receitaContagem : labels.receitasContagem).replace(
          '{n}',
          String(cook.recipeCount),
        )
  const recipes = cook.recipes ?? []
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-3">
        <Link
          href={`/u/${cook.handle}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-fg hover:underline"
        >
          {/* alt="" decorativo: o nome adjacente já nomeia o cozinheiro (evita leitura dupla na AT). */}
          <Avatar src={cook.image} name={cook.name} alt="" size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-1 font-display text-sm font-semibold">{cook.name}</span>
            <span className="line-clamp-1 text-xs text-muted">
              <span>@{cook.handle}</span>
              {countLabel !== null && (
                <>
                  <span aria-hidden> · </span>
                  <span>{countLabel}</span>
                </>
              )}
            </span>
          </span>
        </Link>
        {authed ? (
          <CookFollowButton
            handle={cook.handle}
            initialFollowing={false}
            variant="outline"
            className={FOLLOW_BTN_CLASS}
            labels={{ seguir: labels.seguir, seguindo: labels.seguindo, erroSeguir: labels.erroSeguir }}
          />
        ) : (
          // Anônimo: "Seguir" leva ao sign-in preservando a intenção (volta pra returnTo após login).
          <Link
            href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
            className={`inline-flex shrink-0 items-center justify-center rounded-full border px-3.5 py-1.5 text-sm font-medium ${FOLLOW_BTN_CLASS}`}
          >
            {labels.seguir}
          </Link>
        )}
      </div>
      {recipes.length > 0 && (
        <ul className="flex flex-col">
          {recipes.map((recipe) => (
            <CookRecipeRow key={recipe.recipeId} recipe={recipe} aiLabel={aiLabel} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Uma receita no preview do cartão (estática): thumbnail 40px (foto/moldura) + selo de IA + título serif. */
function CookRecipeRow({ recipe, aiLabel }: { recipe: RecommendedCookRecipe; aiLabel: string }) {
  return (
    <li className="flex items-center gap-2.5 border-t border-border py-2 first:border-t-0">
      <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-brand/[0.07]">
        {recipe.imageUrl != null ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recipe.imageUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
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
