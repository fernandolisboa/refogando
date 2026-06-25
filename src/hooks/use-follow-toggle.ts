'use client'
/**
 * Seam ÚNICO do toggle Seguir/Deixar de seguir (#278) — a lógica OTIMISTA de seguir/deixar com REVERT
 * no erro, compartilhada por `ProfileFollowSection` (#274, bloco do perfil) e `CookFollowButton` (#278,
 * trilho de recomendados). Antes a lógica vivia duplicada em duas ilhas; centralizá-la segue a casa
 * (um seam por regra: `feedQuery`/`listFollowingIds`) e impede que um conserto futuro caia só num lado.
 *
 * Possui SÓ o estado do botão: `isFollowing` (otimista), `busy` (anti-duplo-clique) e `error` (neutro).
 * `toggle()` alterna otimista, faz POST/DELETE em `/api/u/<handle>/follow` e DEVOLVE o corpo do servidor
 * (`{ isFollowing, followerCount }`) no sucesso ou `null` no erro/abort — o consumidor usa o retorno
 * para reconciliar QUALQUER estado próprio (ex.: o `followerCount` do perfil), revertendo quando `null`.
 * Não toca contagem alguma — essa cola fica no consumidor (o trilho nem mostra contador).
 *
 * `credentials` PADRÃO (same-origin) — a mutação É per-viewer (cookie de sessão), NUNCA `omit`.
 */
import { useCallback, useState } from 'react'

export type FollowToggleResult = { isFollowing: boolean; followerCount: number }

export function useFollowToggle({
  handle,
  initialFollowing = false,
}: {
  handle: string
  /** Estado inicial. O trilho semeia `false` (já-seguidos são excluídos ⇒ sem GET por item). */
  initialFollowing?: boolean
}) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  const toggle = useCallback(async (): Promise<FollowToggleResult | null> => {
    if (busy) return null
    setBusy(true)
    setError(false)
    const prev = isFollowing
    setIsFollowing(!prev) // otimista
    try {
      const res = await fetch(`/api/u/${encodeURIComponent(handle)}/follow`, {
        method: prev ? 'DELETE' : 'POST',
      })
      if (!res.ok) {
        // 401/404/422/500 caem todos aqui — reverte e sinaliza erro neutro.
        setIsFollowing(prev)
        setError(true)
        return null
      }
      const body = (await res.json()) as FollowToggleResult
      setIsFollowing(body.isFollowing)
      return body
    } catch {
      setIsFollowing(prev)
      setError(true)
      return null
    } finally {
      setBusy(false)
    }
  }, [busy, isFollowing, handle])

  return { isFollowing, busy, error, toggle, setFollowing: setIsFollowing }
}
