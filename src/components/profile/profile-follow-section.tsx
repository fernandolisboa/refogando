'use client'

/**
 * Bloco SEGUIR do perfil público (#274, ADR-0024) — ILHA client (o `PublicProfileView` é PURO). Mostra
 * a contagem de SEGUIDORES (a que muda quando ESTE viewer segue) + o botão Seguir/Seguindo.
 *
 * Diferente do `RecipeEngagementControls` (que recebe o estado do viewer por PROPS de SSR): o perfil é
 * ANÔN-CACHEÁVEL (Modelo B/ADR-0020), então NÃO há seed SSR do "eu sigo?". A ilha BUSCA o estado client-
 * side (`GET /api/u/<handle>/follow` → `{isFollowing, isSelf}`) SÓ quando a sessão resolve logada — anon
 * nunca toca a API (evita 401-spam). `isSelf` vem do SERVIDOR (compara `session.user.id`, confiável —
 * não o cast não-tipado de `session.user.handle`); próprio perfil ⇒ sem botão. Otimismo no clique com
 * REVERT no erro (mensagem neutra), espelhando o `RecipeEngagementControls`. `credentials` PADRÃO
 * (same-origin) — o estado É viewer-personalizado, NUNCA `credentials:'omit'` (≠ feed anon).
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { useFollowToggle } from '@/hooks/use-follow-toggle'
import type { Messages } from '@/i18n/messages'

export function ProfileFollowSection({
  handle,
  initialFollowerCount,
  labels,
}: {
  handle: string
  initialFollowerCount: number
  /** Rótulos já localizados (a view é prop-driven por `m`; a ilha só hooka a SESSÃO, não o locale). */
  labels: Messages['perfilPublico']
}) {
  const mp = labels
  const { data: session, isPending, error } = useSession()
  const authed = !isPending && !error && !!session

  const [followerCount, setFollowerCount] = useState(initialFollowerCount)
  const [isSelf, setIsSelf] = useState(false)
  const [stateLoaded, setStateLoaded] = useState(false)
  // Seam ÚNICO do toggle (#278): isFollowing/busy/error otimistas + revert vivem em `useFollowToggle`,
  // compartilhado com o `CookFollowButton` do trilho. O `followerCount` (exclusivo do perfil) fica AQUI
  // e reconcilia pelo RETORNO do `toggle()` (corpo do servidor no sucesso; `null` no erro → reverte).
  const { isFollowing, busy, error: err, toggle, setFollowing } = useFollowToggle({ handle })

  // Estado "eu sigo? / sou eu?" SÓ quando logado (sem seed SSR — perfil anon-cacheável). AbortController
  // limpa na desmontagem/troca de handle. Erro/abort ⇒ fica neutro (sem botão), sem quebrar a chrome.
  useEffect(() => {
    // Anon/pendente: não busca (e não reseta estado no corpo do efeito — o render já gateia o botão
    // por `authed`, então um `stateLoaded` obsoleto de uma sessão anterior nunca é mostrado).
    if (!authed) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(`/api/u/${encodeURIComponent(handle)}/follow`, { signal: ctrl.signal })
        if (!res.ok) return
        const body = (await res.json()) as { isFollowing: boolean; isSelf: boolean }
        setFollowing(body.isFollowing)
        setIsSelf(body.isSelf)
        setStateLoaded(true)
      } catch {
        // abort (troca de handle/desmontagem) ou rede: mantém neutro.
      }
    })()
    return () => ctrl.abort()
  }, [authed, handle, setFollowing])

  async function onFollowClick() {
    if (busy) return // anti-duplo-clique ANTES da otimização do contador (sem flash transitório).
    const prevCount = followerCount
    const goingToFollow = !isFollowing
    // Otimista no contador (±1, piso 0 — blinda contra um seed SSR defasado pelo cache do Modelo B
    // mostrar "-1" por um instante). O `toggle()` otimiza o estado do botão e reconcilia tudo no fim.
    setFollowerCount(Math.max(0, prevCount + (goingToFollow ? 1 : -1)))
    const body = await toggle()
    setFollowerCount(body ? body.followerCount : prevCount) // sucesso: do servidor; erro: reverte.
  }

  // Anon resolvido (não-pendente, sem sessão ou erro) → convite. Pendente → nada (sem flash do convite
  // pro logado). Logado+resolvido+não-próprio → botão. Próprio/carregando → nada.
  const resolvedAnon = !isPending && (!!error || !session)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span aria-live="polite" className="text-sm text-muted">
        {(followerCount === 1 ? mp.seguidorContagem : mp.seguidoresContagem).replace(
          '{n}',
          String(followerCount),
        )}
      </span>
      {resolvedAnon ? (
        <Button asChild variant="secondary" size="sm">
          <Link href="/sign-in">{mp.entrarParaSeguir}</Link>
        </Button>
      ) : authed && stateLoaded && !isSelf ? (
        <Button
          type="button"
          onClick={onFollowClick}
          disabled={busy}
          aria-pressed={isFollowing}
          aria-busy={busy}
          variant={isFollowing ? 'default' : 'secondary'}
          size="sm"
          className="disabled:opacity-70"
        >
          {isFollowing ? mp.seguindo : mp.seguir}
        </Button>
      ) : null}
      {err && (
        <span role="alert" className="text-sm font-medium text-fg">
          {mp.erroSeguir}
        </span>
      )}
    </div>
  )
}
