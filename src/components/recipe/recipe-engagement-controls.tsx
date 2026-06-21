'use client'

/**
 * Controles de Engajamento da Comunidade (#62) — bloco de VOTO + FAVORITO na tela de
 * detalhe. Irmão do `RecipeDetailView` (que continua PURO, sem hooks): a page renderiza
 * isto SÓ quando a Receita está no POOL público (algum dos campos sociais presente).
 *
 * ADR-0010: consome os ROUTE HANDLERS `POST /api/recipes/[id]/{vote,unvote,favorite,
 * unfavorite}` via `fetch` (NÃO Server Action). O servidor é a verdade — impõe sessão
 * (401), não-autovoto (422 `auto_voto`) e o gate de pool (404); isto é AFORDÂNCIA: aplica
 * otimismo no clique, espelha a resposta no sucesso, REVERTE no erro com mensagem neutra
 * única (não diferencia 401/422/404 pro usuário).
 *
 * Shapes de resposta DISJUNTOS (verificado no backend #16): vote/unvote devolvem
 * `{voteCount, viewerVoted}`; favorite/unfavorite devolvem APENAS `{viewerFavorited}`. Por
 * isso cada handler lê SÓ a sua fatia — favoritar NUNCA mexe em voteCount/voted (um spread
 * do objeto inteiro zeraria o voto).
 *
 * Cores: só tokens já AA-verificados na #54 (brand/neutros). ÂMBAR (`aviso-*`) é PROIBIDO
 * (ADR-0015: exclusivo do Aviso de restrição) e accent/accent-surface também (reservados a
 * `origin=catalog`, ADR-0015) — Popularidade é eixo separado, NUNCA colore confiança.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

export function RecipeEngagementControls({
  recipeId,
  initialVoteCount,
  initialViewerVoted,
  initialViewerFavorited,
  canManage,
}: {
  recipeId: string
  initialVoteCount?: number
  initialViewerVoted?: boolean
  initialViewerFavorited?: boolean
  canManage: boolean
}) {
  const { messages } = useLocale()
  const m = messages.comunidade

  // Anônimo = AUSÊNCIA dos DOIS campos de viewer (saem juntos do server). Não inferir de
  // voteCount (que existe pra anônimo no pool). Anônimo ⇒ controles viram CONVITE A ENTRAR,
  // sem tocar a API (que daria 401).
  const isAnon = initialViewerVoted === undefined && initialViewerFavorited === undefined

  // O DONO não vota na própria Receita (AC2 — o servidor reforça com 422). O botão de voto
  // some; a CONTAGEM read-only e o FAVORITAR permanecem (dono pode favoritar a própria).
  const showVote = !canManage

  const [voted, setVoted] = useState(!!initialViewerVoted)
  const [favorited, setFavorited] = useState(!!initialViewerFavorited)
  const [voteCount, setVoteCount] = useState<number | undefined>(initialVoteCount)
  const [voteBusy, setVoteBusy] = useState(false)
  const [favBusy, setFavBusy] = useState(false)
  const [voteError, setVoteError] = useState(false)
  const [favError, setFavError] = useState(false)

  async function handleVote() {
    if (voteBusy) return
    setVoteBusy(true)
    setVoteError(false)

    const prevVoted = voted
    const prevCount = voteCount

    // Otimista: alterna o voto e a contagem (só se a contagem está presente).
    setVoted(!prevVoted)
    if (prevCount != null) setVoteCount(prevCount + (prevVoted ? -1 : 1))

    try {
      const res = await fetch(`/api/recipes/${recipeId}/${prevVoted ? 'unvote' : 'vote'}`, {
        method: 'POST',
      })
      if (!res.ok) {
        // 401/404/422 caem todos aqui — reverte ao snapshot e mostra erro neutro único.
        setVoted(prevVoted)
        setVoteCount(prevCount)
        setVoteError(true)
        return
      }
      const body = (await res.json()) as { voteCount?: number; viewerVoted: boolean }
      // Servidor é a verdade: corrige o otimismo SÓ na fatia de voto. NÃO chamamos
      // `router.refresh()`: o corpo do POST já é autoritativo (o estado exibido vem dele) e
      // nada na page deriva de voto/favorito (o `RecipeDetailView` não os lê), então um
      // re-fetch server-side da árvore inteira seria trabalho descartado — os props frescos
      // só alimentam inicializadores de `useState`, que não re-rodam sem remontar.
      setVoted(body.viewerVoted)
      if (body.voteCount != null) setVoteCount(body.voteCount)
    } catch {
      setVoted(prevVoted)
      setVoteCount(prevCount)
      setVoteError(true)
    } finally {
      setVoteBusy(false)
    }
  }

  async function handleFavorite() {
    if (favBusy) return
    setFavBusy(true)
    setFavError(false)

    const prevFavorited = favorited
    setFavorited(!prevFavorited)

    try {
      const res = await fetch(
        `/api/recipes/${recipeId}/${prevFavorited ? 'unfavorite' : 'favorite'}`,
        { method: 'POST' },
      )
      if (!res.ok) {
        setFavorited(prevFavorited)
        setFavError(true)
        return
      }
      // /favorite e /unfavorite devolvem SÓ `{viewerFavorited}` — lê APENAS essa fatia.
      // NUNCA spread/replace do objeto de estado (zeraria voteCount/voted).
      const body = (await res.json()) as { viewerFavorited: boolean }
      setFavorited(body.viewerFavorited)
      // Sem `router.refresh()`: idem handleVote — o corpo do POST é autoritativo e nada na
      // page deriva do favorito, então o round-trip full-page seria descartado.
    } catch {
      setFavorited(prevFavorited)
      setFavError(true)
    } finally {
      setFavBusy(false)
    }
  }

  // Singular/plural via duas chaves + placeholder `{n}` (folhas do tipo são string).
  const contagemTexto =
    voteCount == null
      ? null
      : voteCount === 1
        ? m.voto.replace('{n}', '1')
        : m.votos.replace('{n}', String(voteCount))

  return (
    <section
      aria-labelledby="engajamento-titulo"
      className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3"
    >
      <h2 id="engajamento-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>

      {contagemTexto != null && (
        // aria-live: o leitor de tela ouve a contagem mudar (3→4) além do toggle de aria-pressed.
        <span aria-live="polite" className="text-sm text-muted">
          {contagemTexto}
        </span>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {isAnon ? (
          <>
            {showVote && (
              <Button asChild variant="secondary">
                <Link href="/sign-in">{m.convidaEntrarVoto}</Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link href="/sign-in">{m.convidaEntrarFavorito}</Link>
            </Button>
          </>
        ) : (
          <>
            {showVote && (
              <Button
                type="button"
                onClick={handleVote}
                disabled={voteBusy}
                aria-pressed={voted}
                aria-busy={voteBusy}
                variant={voted ? 'default' : 'secondary'}
                className="disabled:opacity-70"
              >
                {voted ? m.votado : m.votar}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleFavorite}
              disabled={favBusy}
              aria-pressed={favorited}
              aria-busy={favBusy}
              variant={favorited ? 'default' : 'secondary'}
              className="disabled:opacity-70"
            >
              {favorited ? m.favoritado : m.favoritar}
            </Button>
          </>
        )}
      </div>

      {voteError && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.erroVoto}
        </p>
      )}
      {favError && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.erroFavorito}
        </p>
      )}
    </section>
  )
}
