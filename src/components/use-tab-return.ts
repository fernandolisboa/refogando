'use client'
/**
 * Volta à aba (ADR-0028): chama `callback` UMA vez por volta. Voltar pra aba dispara `focus` (window)
 * E `visibilitychange`→visible (document), em ordem que varia por browser; os dois são coalescidos —
 * um segundo evento a menos de `TAB_RETURN_COALESCE_MS` do último disparo é ignorado. Um refoco
 * simples da janela (só `focus`) também dispara uma vez.
 *
 * `enabled=false` não instala listeners. O instante do último disparo vive num ref (sobrevive a
 * enabled piscar, ex.: isPending do useSession durante um refetch) e o callback é sempre o mais
 * recente (ref) — os listeners não são reinstalados a cada render.
 */
import { useEffect, useRef } from 'react'

export const TAB_RETURN_COALESCE_MS = 1000

export function useOnTabReturn(callback: () => void, enabled = true): void {
  const callbackRef = useRef(callback)
  const lastFireRef = useRef(Number.NEGATIVE_INFINITY)

  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!enabled) return
    const fire = () => {
      const now = Date.now()
      if (now - lastFireRef.current < TAB_RETURN_COALESCE_MS) return
      lastFireRef.current = now
      callbackRef.current()
    }
    // LANDMINE: `visibilitychange` também dispara ao ESCONDER — só agir em 'visible'.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fire()
    }
    window.addEventListener('focus', fire)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', fire)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}
