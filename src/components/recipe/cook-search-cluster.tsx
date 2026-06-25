'use client'
/**
 * Cluster de Cozinheiros da Busca mesclada (#279, ADR-0024) — flutua ACIMA das Receitas quando algum
 * Cozinheiro casa o termo (força-de-match: exato>prefixo>substring, vindo do seam `searchCooks`/#269).
 * Compacto: mostra os primeiros `COOK_CLUSTER_COLLAPSED`; "Ver todos" revela o resto JÁ buscado (≤
 * COOK_SEARCH_LIMIT) num toggle in-place. Cartões linkam pro perfil público (`/u/<handle>`) — SEGUIR
 * acontece lá (v1 sem botão Seguir aqui: a resposta fica viewer-independente/cacheável e o estado
 * "já sigo?" de um resultado de busca não pode ser semeado como o trilho #278 faz).
 *
 * Retorna `null` quando vazio (sem heading órfão, espelha `SearchSection`). O RESET do `expanded` ao
 * trocar de busca é responsabilidade do pai (remonta via `key` = assinatura dos cooks) — sem setState
 * em effect. Apresentacional puro: recebe `cooks` por prop, sem fetch próprio.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Avatar } from '@/components/profile/avatar'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'

/** Quantos cartões aparecem antes do "Ver todos". Reversível — knob de produto. */
export const COOK_CLUSTER_COLLAPSED = 3

export function CookSearchCluster({ cooks }: { cooks: ProfileFollowUser[] }) {
  const { messages } = useLocale()
  const m = messages.buscaCozinheiros
  const [expanded, setExpanded] = useState(false)

  if (cooks.length === 0) return null
  const shown = expanded ? cooks : cooks.slice(0, COOK_CLUSTER_COLLAPSED)
  const hasMore = cooks.length > COOK_CLUSTER_COLLAPSED

  return (
    <section aria-labelledby="cook-search-heading" className="flex flex-col gap-3">
      <h2 id="cook-search-heading" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>
      <ul className="flex flex-col gap-1">
        {shown.map((cook) => (
          <li key={cook.handle}>
            <Link
              href={`/u/${cook.handle}`}
              className="flex items-center gap-3 rounded-md px-2 py-1.5 text-fg hover:bg-surface"
            >
              <Avatar src={cook.image} name={cook.name} alt={cook.name} size="sm" />
              <span className="flex min-w-0 flex-col">
                <span className="line-clamp-1 font-display text-sm font-semibold">{cook.name}</span>
                <span className="line-clamp-1 text-xs text-muted">@{cook.handle}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="self-start text-sm font-medium text-muted hover:text-fg"
        >
          {expanded ? m.verMenos : m.verTodos}
        </button>
      )}
    </section>
  )
}
