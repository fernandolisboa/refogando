'use client'
/**
 * Trilho "Cozinheiros pra seguir" (#278, ADR-0024) — ilha cliente na home-Descoberta (Explorar). Lista
 * Cozinheiros recomendados por POPULARIDADE GLOBAL (votos+favoritos de terceiros), com botão Seguir.
 *
 * SÓ-LOGADO + Modelo B: renderiza `null` no SSR e para Visitante/sessão-pendente (a home anon/indexável
 * fica byte-idêntica — `useSession` é client-only/pendente no SSR, nunca semeia viewer no servidor).
 * Busca `/api/discovery/cooks` (COM cookie de sessão — per-viewer; exclui o próprio e quem já segue).
 * Some por inteiro abaixo do limiar (`shouldShowRecommendedRail`) — degrada gracioso com pouca gente.
 *
 * Dados LOCALE-INDEPENDENTES (nome/@handle/avatar, sem tradução) ⇒ busca keyed só em `[authed]` (troca de
 * idioma só re-rotula via `useLocale`, não re-busca). Cartões num trilho horizontal (`overflow-x-auto`):
 * fila no desktop, carrossel por swipe no mobile (sem lib). FORA de qualquer live region (não é status
 * efêmero). `<h2>` sob o `<h1>` "Busca" da `SearchExperience`. Cada cartão semeia o botão como
 * "não-seguindo" (já-seguidos vêm excluídos ⇒ sem GET por item).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Avatar } from '@/components/profile/avatar'
import { CookFollowButton } from './cook-follow-button'
import {
  shouldShowRecommendedRail,
  type RecommendedCook,
} from '@/domain/recommended-cooks-read'

export function CooksToFollowRail() {
  const { messages } = useLocale()
  const m = messages.cozinheirosSugeridos
  const session = useSession()
  // Só busca depois que a sessão resolveu E está logado (Visitante/pendente ⇒ nada, sem 401 inútil).
  const authed = !session.isPending && !session.error && !!session.data

  const [cooks, setCooks] = useState<RecommendedCook[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!authed) return
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/api/discovery/cooks', { signal: controller.signal }) // COM cookie
        if (!res.ok) return // erro/401: trilho assistivo — silencia (fica oculto)
        const body = (await res.json()) as { cooks: RecommendedCook[] }
        setCooks(body.cooks ?? [])
        setLoaded(true)
      } catch {
        // abort (desmontagem) ou rede caída: mantém oculto.
      }
    })()
    return () => controller.abort()
  }, [authed])

  // Visitante/pendente/carregando ⇒ nada (SSR e anon byte-idênticos: Modelo B). Abaixo do limiar ⇒
  // some por inteiro (degrada gracioso). Só pinta com lista suficiente.
  if (!authed || !loaded) return null
  if (!shouldShowRecommendedRail(cooks.length)) return null

  return (
    <section aria-labelledby="cooks-to-follow-heading" className="flex flex-col gap-3">
      <h2
        id="cooks-to-follow-heading"
        className="font-display text-lg font-semibold text-fg"
      >
        {m.titulo}
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {cooks.map((cook) => {
          const countLabel = (cook.recipeCount === 1 ? m.receitaContagem : m.receitasContagem).replace(
            '{n}',
            String(cook.recipeCount),
          )
          return (
            <li
              key={cook.handle}
              className="flex w-40 shrink-0 flex-col items-start gap-2 rounded-md border border-border bg-surface p-3"
            >
              <Link
                href={`/u/${cook.handle}`}
                className="flex w-full flex-col items-start gap-1.5 text-fg hover:underline"
              >
                <Avatar src={cook.image} name={cook.name} alt={cook.name} size="sm" />
                <span className="line-clamp-1 font-display text-sm font-semibold">{cook.name}</span>
                <span className="line-clamp-1 text-xs text-muted">@{cook.handle}</span>
                <span className="text-xs text-muted">{countLabel}</span>
              </Link>
              <CookFollowButton
                handle={cook.handle}
                initialFollowing={false}
                labels={{ seguir: m.seguir, seguindo: m.seguindo, erroSeguir: m.erroSeguir }}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
