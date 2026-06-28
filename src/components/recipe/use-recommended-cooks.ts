'use client'
/**
 * Hook do trilho "Cozinheiros em alta" (#278, ADR-0024 emendado) — ELEVA o fetch dos recomendados pro
 * dono da superfície (`SearchExperience`), pra que o LAYOUT da home (largura + 3ª coluna em telas largas)
 * possa decidir, NUM ÚNICO render, se vai abrir pra 3 colunas (sem coluna fantasma vazia no caso anon/
 * SSR/poucos-cozinheiros). Antes o fetch vivia DENTRO do `CooksToFollowRail`, o que travava o layout:
 * a 3ª coluna não montava ⇒ o rail não buscava ⇒ o layout nunca sabia se ia ter conteúdo (deadlock).
 *
 * SÓ-LOGADO + Modelo B: `useSession` é client-only/pendente no SSR ⇒ no servidor e p/ Visitante/sessão-
 * pendente devolve `cooks: []` e NÃO busca (a home anon/indexável segue byte-idêntica — nenhum viewer
 * semeado no servidor). Busca `/api/discovery/cooks` (COM cookie de sessão — per-viewer; exclui o próprio
 * e quem já segue) com `?locale=` (o preview de receitas traz títulos LOCALIZADOS, ADR-0024 emendado).
 * Falha (erro/401/rede) ⇒ mantém `cooks: []` (assistivo — o trilho some). Re-busca quando o idioma muda.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

export function useRecommendedCooks(): { cooks: RecommendedCook[] } {
  const { locale } = useLocale()
  const session = useSession()
  // Só busca depois que a sessão resolveu E está logado (Visitante/pendente ⇒ nada, sem 401 inútil).
  const authed = !session.isPending && !session.error && !!session.data

  const [cooks, setCooks] = useState<RecommendedCook[]>([])

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      // Visitante/pendente (Modelo B) ⇒ limpa (cobre o logout: o trilho some) e NÃO busca. A limpeza vive
      // DENTRO do bloco async (não no corpo síncrono do effect) e usa update funcional que dá no-op quando
      // já está vazio — sem re-render espúrio no SSR/anon (a home indexável fica byte-idêntica).
      if (!authed) {
        setCooks((prev) => (prev.length === 0 ? prev : []))
        return
      }
      try {
        const url = new URL('/api/discovery/cooks', window.location.origin)
        url.searchParams.set('locale', locale) // títulos do preview LOCALIZADOS (ADR-0024 emendado)
        const res = await fetch(url, { signal: controller.signal }) // COM cookie de sessão
        if (!res.ok) return // erro/401: trilho assistivo — silencia (fica oculto)
        const body = (await res.json()) as { cooks: RecommendedCook[] }
        setCooks(body.cooks ?? [])
      } catch {
        // abort (desmontagem / troca de idioma) ou rede caída: mantém oculto.
      }
    })()
    return () => controller.abort()
  }, [authed, locale])

  return { cooks }
}
