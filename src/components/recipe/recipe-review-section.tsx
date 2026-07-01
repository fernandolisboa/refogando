'use client'

/**
 * Seção de AVALIAÇÕES da Receita (#363, ADR-0027) — média + contagem, lista pública e o widget
 * de estrelas + comentário do viewer. Irmã de `RecipeEngagementControls`: a página renderiza
 * isto SÓ quando a Receita está no POOL (o loader devolveu `reviews != null`).
 *
 * ESTADO DO VIEWER (já avaliou? sua nota?), como no engagement controls (#230, ADR-0020):
 *  - `canManage` (dono, resolvido no servidor): o dono NÃO avalia a própria (auto-avaliação
 *    barrada) ⇒ sem widget, só a lista/agregado.
 *  - Logado não-dono: no mount busca `GET /reviews/mine`; se `isOwner` (posse descoberta no
 *    caminho público) esconde o widget; se já tem avaliação, prefill + Editar/Apagar; senão, o
 *    widget de criar.
 *  - Anônimo (sessão resolvida, sem dado): convite "Entrar para avaliar" (Link p/ /sign-in).
 *  - Enquanto a sessão/fetch pendem: só lista/agregado, sem piscar o widget.
 *
 * Consome os ROUTE HANDLERS via `fetch` (o servidor é a verdade — impõe sessão/gate/auto-
 * avaliação). Otimista no envio; no sucesso re-busca `GET /reviews` pra refrescar lista+agregado
 * (SEM `router.refresh()` — a página pública é cacheável). Mensagem de erro neutra única.
 *
 * Cores: só tokens brand/neutros AA-verificados. SEM âmbar (`aviso-*`), SEM accent/accent-surface
 * (ADR-0015 reserva-os ao eixo catálogo/restrição) — nem nas estrelas.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type ReviewViewSerialized = {
  id: string
  rating: number
  comment: string | null
  author: { name: string | null; handle: string | null }
  createdAt: string // ISO — a página serializa Dates antes de passar
}

const MAX_STARS = 5

/** Estrelas SÓ-LEITURA (exibição de uma nota). Preenchidas até `value`, vazias depois. */
function StarsReadonly({ value, label }: { value: number; label: string }) {
  return (
    <span aria-label={label} className="text-fg" role="img">
      {Array.from({ length: MAX_STARS }, (_, i) => (
        <span key={i} aria-hidden="true">
          {i < value ? '★' : '☆'}
        </span>
      ))}
    </span>
  )
}

export function RecipeReviewSection({
  recipeId,
  initialReviews,
  initialAverage,
  initialCount,
  canManage,
}: {
  recipeId: string
  initialReviews: ReviewViewSerialized[]
  initialAverage: number | null
  initialCount: number
  canManage: boolean
}) {
  const { locale, messages } = useLocale()
  const m = messages.avaliacoes
  const session = useSession()

  const sessionSettled = !session.isPending
  const loggedIn = sessionSettled && !session.error && !!session.data

  const [reviews, setReviews] = useState(initialReviews)
  const [average, setAverage] = useState(initialAverage)
  const [count, setCount] = useState(initialCount)

  // Estado do viewer: `rating` 0 = nenhuma; `hasReview` = já tem linha (mostra Editar/Apagar).
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [hasReview, setHasReview] = useState(false)
  const [viewerResolved, setViewerResolved] = useState(false)
  const [ownerClient, setOwnerClient] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Logado não-dono: resolve a PRÓPRIA avaliação (a página é cacheável, o server lê anônimo).
  // Anônimo/dono não busca. Falha ⇒ resolve com defaults (não trava logado sem widget).
  useEffect(() => {
    if (canManage || !loggedIn) return
    let cancelled = false
    fetch(`/api/recipes/${recipeId}/reviews/mine`)
      .then(async (res) => {
        if (cancelled) return
        if (res.ok) {
          const body = (await res.json()) as {
            viewerReview: { rating: number; comment: string | null } | null
            isOwner: boolean
          }
          setOwnerClient(!!body.isOwner)
          if (body.viewerReview) {
            setRating(body.viewerReview.rating)
            setComment(body.viewerReview.comment ?? '')
            setHasReview(true)
          }
        }
        setViewerResolved(true)
      })
      .catch(() => {
        if (!cancelled) setViewerResolved(true)
      })
    return () => {
      cancelled = true
    }
  }, [recipeId, canManage, loggedIn])

  async function refreshList() {
    try {
      const res = await fetch(`/api/recipes/${recipeId}/reviews`)
      if (!res.ok) return
      const body = (await res.json()) as {
        average: number | null
        count: number
        reviews: ReviewViewSerialized[]
      }
      setReviews(body.reviews)
      setAverage(body.average)
      setCount(body.count)
    } catch {
      // silencioso — o agregado do envio já é autoritativo pro estado próprio.
    }
  }

  async function handleSubmit() {
    if (busy || rating < 1) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() === '' ? null : comment.trim() }),
      })
      if (!res.ok) {
        setError(m.erroEnviar)
        return
      }
      const body = (await res.json()) as {
        average: number | null
        count: number
        viewerRating: number | null
        viewerComment: string | null
      }
      setHasReview(true)
      setRating(body.viewerRating ?? rating)
      setComment(body.viewerComment ?? '')
      setAverage(body.average)
      setCount(body.count)
      await refreshList()
    } catch {
      setError(m.erroEnviar)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/recipes/${recipeId}/reviews`, { method: 'DELETE' })
      if (!res.ok) {
        setError(m.erroApagar)
        return
      }
      const body = (await res.json()) as { average: number | null; count: number }
      setHasReview(false)
      setRating(0)
      setComment('')
      setAverage(body.average)
      setCount(body.count)
      await refreshList()
    } catch {
      setError(m.erroApagar)
    } finally {
      setBusy(false)
    }
  }

  // Média formatada por locale (pt-BR usa vírgula, en-US ponto), 1 casa decimal.
  const mediaFmt =
    average == null ? null : average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  const aggregateLine =
    mediaFmt == null
      ? null
      : count === 1
        ? m.mediaUma.replace('{media}', mediaFmt)
        : m.media.replace('{media}', mediaFmt).replace('{n}', String(count))

  const starLabel = (n: number) => (n === 1 ? m.estrela : m.estrelas).replace('{n}', String(n))

  // Widget de nota: aparece só quando logado, não-dono e resolvido.
  const showWidget = !canManage && !ownerClient && loggedIn && viewerResolved
  const showAnonInvite = !canManage && sessionSettled && !loggedIn

  return (
    <section
      aria-labelledby="avaliacoes-titulo"
      className="flex flex-col gap-4 rounded-md border border-border bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="avaliacoes-titulo" className="font-display text-lg font-semibold text-fg">
          {m.titulo}
        </h2>
        {aggregateLine != null && <span className="text-sm text-muted">{aggregateLine}</span>}
      </div>

      {/* Widget de avaliar/editar (logado, não-dono). */}
      {showWidget && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <div>
            <span id="nota-label" className="text-sm font-medium text-foreground">
              {m.notaLabel}
            </span>
            <div role="radiogroup" aria-labelledby="nota-label" className="mt-1 flex gap-1">
              {Array.from({ length: MAX_STARS }, (_, i) => {
                const n = i + 1
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={starLabel(n)}
                    onClick={() => setRating(n)}
                    disabled={busy}
                    className="text-2xl leading-none text-fg transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    <span aria-hidden="true">{n <= rating ? '★' : '☆'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="avaliacao-comentario">{m.comentarioLabel}</Label>
            <Textarea
              id="avaliacao-comentario"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={m.comentarioPlaceholder}
              rows={3}
              disabled={busy}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleSubmit} disabled={busy || rating < 1} aria-busy={busy}>
              {busy ? m.salvando : hasReview ? m.editar : m.enviar}
            </Button>
            {hasReview && (
              <Button type="button" variant="secondary" onClick={handleDelete} disabled={busy}>
                {m.apagar}
              </Button>
            )}
          </div>

          {error != null && (
            <Alert variant="info" role="alert">
              <AlertDescription className="font-medium text-foreground">{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {/* Convite pra anônimo. */}
      {showAnonInvite && (
        <div className="border-t border-border pt-3">
          <Button asChild variant="secondary">
            <Link href="/sign-in">{m.convidaEntrar}</Link>
          </Button>
        </div>
      )}

      {/* Lista de avaliações (ou vazio). */}
      <ul className="flex flex-col gap-4 border-t border-border pt-3">
        {reviews.length === 0 ? (
          <li className="text-sm text-muted">{m.semAvaliacoes}</li>
        ) : (
          reviews.map((r) => (
            <li key={r.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <StarsReadonly value={r.rating} label={starLabel(r.rating)} />
                {r.author.handle ? (
                  <Link
                    href={`/u/${r.author.handle}`}
                    className="text-sm font-medium text-fg transition-colors hover:text-muted"
                  >
                    {r.author.name ?? `@${r.author.handle}`}
                  </Link>
                ) : (
                  <span className="text-sm font-medium text-fg">{r.author.name ?? ''}</span>
                )}
              </div>
              {r.comment != null && r.comment !== '' && (
                <p className="text-sm text-foreground whitespace-pre-line">{r.comment}</p>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
