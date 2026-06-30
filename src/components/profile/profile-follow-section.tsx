'use client'

/**
 * Bloco SEGUIR do perfil público (#274, ADR-0024) — ILHA client (o `PublicProfileView` é PURO).
 *
 * Layout estilo Instagram (refinação de UX): uma LINHA DE STATS com TRÊS contadores inline e o número
 * em NEGRITO — "{n} receitas · {n} seguidores · {n} seguindo" — e o BOTÃO Seguir/Seguindo numa LINHA
 * ABAIXO (nunca inline com os contadores). RECEITAS (`recipesCount`, vem de `recipes.length` na view,
 * sem nova query) e SEGUINDO (`followingCount`) são ESTÁTICOS/SSR; só SEGUIDORES é DINÂMICO (muda quando
 * ESTE viewer segue), com `aria-live` no NÚMERO ⇒ o perfil segue anon-cacheável (Modelo B/ADR-0020).
 *
 * Contadores CLICÁVEIS (versão lite — a lista completa clicável é o #307): cada um é uma âncora pra MESMA
 * página, apontando pros IDs das <section> definidas na `public-profile-view.tsx` (acoplamento DELIBERADO,
 * mantido em sincronia aqui): `#perfil-receitas`, `#perfil-seguidores`, `#perfil-seguindo`. Receitas
 * linka SEMPRE (a seção de receitas sempre existe). Seguidores/seguindo só viram link quando o contador
 * é > 0 — a seção-alvo só renderiza com ≥ 1 (contador e lista concordam: ambos gateiam soft-deleted);
 * contador 0 = texto puro, sem link (não há âncora pra onde ir).
 *
 * MESMO padrão do caminho público do `RecipeEngagementControls` (`GET /api/recipes/<id>/social`): o
 * perfil é ANÔN-CACHEÁVEL (Modelo B/ADR-0020), então NÃO há seed SSR do "eu sigo?". A ilha BUSCA o estado
 * client-side (`GET /api/u/<handle>/follow` → `{isFollowing, isSelf}`) SÓ quando a sessão resolve logada —
 * anon nunca toca a API (evita 401-spam). `isSelf` vem do SERVIDOR (compara `session.user.id`, confiável —
 * não o cast não-tipado de `session.user.handle`); próprio perfil ⇒ sem botão. Otimismo no clique com
 * REVERT no erro (mensagem neutra), espelhando o `RecipeEngagementControls`. `credentials` PADRÃO
 * (same-origin) — o estado É viewer-personalizado, NUNCA `credentials:'omit'` (≠ feed anon).
 */
import { useEffect, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { useFollowToggle } from '@/hooks/use-follow-toggle'
import { FollowListModal } from '@/components/profile/follow-list-modal'
import type { Messages } from '@/i18n/messages'

/**
 * Um contador da linha de stats: "{n} <palavra>" com o NÚMERO em `<strong>` (negrito). `live` põe
 * `aria-live="polite"` SÓ no número (usado pelo de seguidores, que muda no clique). `href` ⇒ âncora
 * clicável (nome acessível = "n palavra"); sem `href` ⇒ texto puro (contador 0, sem seção-alvo).
 */
function StatCounter({
  template,
  n,
  href,
  live,
  onClick,
}: {
  template: string
  n: number
  href?: string
  live?: boolean
  /** Progressive enhancement (#307): seguidores/seguindo `preventDefault`→abrem o modal; receitas não
   *  passa `onClick` (mantém a navegação-âncora). Sem JS, o `href` cai pro preview existente na página. */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void
}) {
  // O template tem o placeholder '{n}'; partir nele deixa o número isolado pra ir em <strong>.
  const [before = '', after = ''] = template.split('{n}')
  const inner = (
    <>
      {before}
      <strong className="font-semibold text-fg" aria-live={live ? 'polite' : undefined}>
        {n}
      </strong>
      {after}
    </>
  )
  return href ? (
    <a href={href} onClick={onClick} className="transition-colors hover:text-fg">
      {inner}
    </a>
  ) : (
    <span>{inner}</span>
  )
}

export function ProfileFollowSection({
  handle,
  recipesCount,
  initialFollowerCount,
  followingCount,
  labels,
}: {
  handle: string
  /** Contagem de RECEITAS públicas — vem de `recipes.length` na view (estática SSR, sem nova query). */
  recipesCount: number
  initialFollowerCount: number
  /** Contagem de SEGUINDO — estática SSR (não muda no clique do viewer; perfil anon-cacheável). */
  followingCount: number
  /** Rótulos já localizados (a view é prop-driven por `m`; a ilha só hooka a SESSÃO, não o locale). */
  labels: Messages['perfilPublico']
}) {
  const mp = labels
  const { data: session, isPending, error } = useSession()
  const authed = !isPending && !error && !!session

  const [followerCount, setFollowerCount] = useState(initialFollowerCount)
  const [isSelf, setIsSelf] = useState(false)
  const [stateLoaded, setStateLoaded] = useState(false)
  // Lista COMPLETA (#307): qual aba o modal mostra (null = fechado). Os contadores seguidores/seguindo
  // abrem-na; receitas segue só a navegação-âncora.
  const [listKind, setListKind] = useState<'followers' | 'following' | null>(null)
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

  const seguidoresTemplate = followerCount === 1 ? mp.seguidorContagem : mp.seguidoresContagem
  const receitasTemplate = recipesCount === 1 ? mp.receitaContagem : mp.receitasContagem

  return (
    <div className="flex flex-col gap-3">
      {/* LINHA DE STATS estilo Instagram (número em negrito). IDs das âncoras ACOPLADOS às <section> da
          public-profile-view.tsx — manter em sincronia. Receitas linka SEMPRE (seção sempre existe);
          seguidores/seguindo SÓ quando > 0 (a seção-alvo só renderiza com ≥1). Separadores aria-hidden. */}
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
        <StatCounter template={receitasTemplate} n={recipesCount} href="#perfil-receitas" />
        <span aria-hidden="true">·</span>
        <StatCounter
          template={seguidoresTemplate}
          n={followerCount}
          href={followerCount > 0 ? '#perfil-seguidores' : undefined}
          onClick={
            followerCount > 0
              ? (e) => {
                  e.preventDefault()
                  setListKind('followers')
                }
              : undefined
          }
          live
        />
        <span aria-hidden="true">·</span>
        <StatCounter
          template={mp.seguindoContagem}
          n={followingCount}
          href={followingCount > 0 ? '#perfil-seguindo' : undefined}
          onClick={
            followingCount > 0
              ? (e) => {
                  e.preventDefault()
                  setListKind('following')
                }
              : undefined
          }
        />
      </p>
      {/* BOTÃO numa LINHA ABAIXO dos contadores (≠ inline): Seguir/Seguindo (logado, não-próprio),
          "Entrar para seguir" (anon) ou nada (próprio/carregando). */}
      {resolvedAnon ? (
        <div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/sign-in">{mp.entrarParaSeguir}</Link>
          </Button>
        </div>
      ) : authed && stateLoaded && !isSelf ? (
        <div className="flex flex-wrap items-center gap-3">
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
          {err && (
            <span role="alert" className="text-sm font-medium text-fg">
              {mp.erroSeguir}
            </span>
          )}
        </div>
      ) : null}
      {/* Modal da lista COMPLETA (#307) — controlado por `listKind`. Render único; `kind` cai pra
          'followers' enquanto fechado (`open=false` ⇒ o modal não busca). Fechar ⇒ `listKind=null`. */}
      <FollowListModal
        handle={handle}
        kind={listKind ?? 'followers'}
        open={listKind !== null}
        onOpenChange={(o) => {
          if (!o) setListKind(null)
        }}
        labels={mp}
      />
    </div>
  )
}
