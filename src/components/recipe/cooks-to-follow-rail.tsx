'use client'
/**
 * Trilho "Cozinheiros em alta" (#278, ADR-0024 emendado) — coluna à direita da home-Descoberta em telas
 * largas (≥1280px); abaixo disso, seção no FIM do feed. Lista Cozinheiros recomendados por POPULARIDADE
 * GLOBAL, cada CARTÃO (`CookCard`, compartilhado com a Descoberta de Cozinheiros #308) com avatar + nome +
 * `@handle · N receitas` + Seguir + preview (1–3) de receitas. Fecha com um link "Ver mais" → `/cooks`.
 *
 * APRESENTACIONAL: recebe `cooks` por prop. O fetch + o gate de sessão (Modelo B: nada p/ anon/SSR) +
 * o piso de exibição (`shouldShowRecommendedRail`) vivem no PAI (`SearchExperience` via
 * `useRecommendedCooks`), pra o LAYOUT decidir num único render se abre a 3ª coluna — sem coluna fantasma
 * vazia no caso anon/poucos-cozinheiros. Renderiza `null` quando vazio (defesa; o pai já gateia). FORA de
 * qualquer live region (não é status efêmero). `<h2>` sob o `<h1>` sr-only da `SearchExperience`. Só-logado,
 * então os cartões usam o default `authed=true` (Seguir inline).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { CookCard } from './cook-card'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

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
            <CookCard cook={cook} labels={m} aiLabel={aiLabel} />
          </li>
        ))}
      </ul>
      {/* #308: o "Ver mais" do mock ganhou destino — a Descoberta de Cozinheiros dedicada. */}
      <Link href="/cooks" className="text-sm font-medium text-brand-ink hover:underline">
        {m.verMais}
      </Link>
    </section>
  )
}
