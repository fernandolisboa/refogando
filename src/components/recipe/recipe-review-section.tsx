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
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from '@/lib/auth-client'
import { useLocale } from '@/i18n/provider'
import { resizeImage } from '@/lib/image-resize'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type ReviewViewSerialized = {
  id: string
  rating: number
  comment: string | null
  // #365: FOTO do prato (upload/câmera, NUNCA IA). URL pública do blob; null quando não há foto.
  photoUrl: string | null
  author: { name: string | null; handle: string | null }
  createdAt: string // ISO — a página serializa Dates antes de passar
}

/** Corpo do GET /reviews/mine — estado per-viewer (id/dono/moderação da própria avaliação). */
type MineBody = {
  viewerReview: { id: string; rating: number; comment: string | null; photoUrl: string | null } | null
  isOwner: boolean
  moderated?: boolean
}

const MAX_STARS = 5

/** #365: cap de tamanho da foto (2 MB) — espelha o border do servidor; o cliente já redimensiona. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
/** Tipos aceitos após o resize (webp no happy-path). heic/gif de fallback caem aqui e são recusados. */
const ACCEPTED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
/** Extensão do arquivo redimensionado (só pro nome no FormData; o servidor re-encoda de qualquer forma). */
function extForPhoto(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/jpeg') return 'jpg'
  return 'webp'
}
/** Cria um object-URL de preview; `null` em ambientes sem suporte (jsdom) — a foto não some por isso. */
function makeObjectUrl(blob: Blob): string | null {
  try {
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

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
  const pathname = usePathname()
  const returnTo = pathname ?? '/'

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
  // #366: a PRÓPRIA avaliação do viewer foi MODERADA (removida pelo Curador). Quando true, trocamos o
  // widget editável por um aviso só-leitura — o delete é no-op durável no servidor, então não oferecemos
  // Editar/Apagar que mentiriam sucesso e a linha reapareceria no reload.
  const [viewerModerated, setViewerModerated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // #365: estado da FOTO do prato. `photoFile` = novo blob (já redimensionado) a enviar; `photoPreview`
  // = object-URL do blob escolhido; `removePhoto` = pediu pra tirar a foto atual; `existingPhotoUrl` =
  // a foto já salva (vinda do /mine, prefill); `photoError` = erro inline de tipo/tamanho/envio da foto.
  const [photoFile, setPhotoFile] = useState<Blob | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // #461 (a11y): o grupo de estrelas é um `radiogroup` (padrão APG) — UMA parada de tab (roving
  // tabindex), setas navegam. `starRefs` guarda os 5 botões p/ mover o FOCO junto da seleção.
  const starRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Seta/Home/End: seleciona o alvo E move o foco (APG "radio group"); wrap circular. `n` é 1..MAX.
  function handleStarKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, n: number) {
    let target: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        target = n >= MAX_STARS ? 1 : n + 1
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        target = n <= 1 ? MAX_STARS : n - 1
        break
      case 'Home':
        target = 1
        break
      case 'End':
        target = MAX_STARS
        break
      default:
        return
    }
    e.preventDefault()
    setRating(target)
    starRefs.current[target - 1]?.focus()
  }

  // #366: id da PRÓPRIA avaliação do viewer (esconde "Reportar" na própria linha da lista); estado do
  // affordance de reportar por review: qual form está aberto, o rascunho de motivo, quais já foram
  // reportadas (estado "Reportado" desabilitado), qual está em voo e qual tem erro.
  const [myReviewId, setMyReviewId] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportReason, setReportReason] = useState<Record<string, string>>({})
  const [reportedIds, setReportedIds] = useState<Record<string, boolean>>({})
  const [reportBusyId, setReportBusyId] = useState<string | null>(null)
  const [reportErrorId, setReportErrorId] = useState<string | null>(null)

  // Logado não-dono: resolve a PRÓPRIA avaliação (a página é cacheável, o server lê anônimo).
  // Anônimo/dono não busca. Falha ⇒ NÃO resolve o viewer: o widget fica escondido (o servidor
  // não confirmou que este viewer não é o dono, e o dono nunca pode ver o controle de avaliar).
  useEffect(() => {
    if (canManage || !loggedIn) return
    let cancelled = false
    fetch(`/api/recipes/${recipeId}/reviews/mine`)
      .then(async (res) => {
        if (cancelled) return
        if (res.ok) applyMineBody((await res.json()) as MineBody)
        setViewerResolved(true)
      })
      .catch(() => {
        // Falha de rede: deixa `viewerResolved` false ⇒ widget escondido (preserva a garantia de
        // que o dono não vê o controle; um não-dono legítimo pode recarregar a página).
      })
    return () => {
      cancelled = true
    }
  }, [recipeId, canManage, loggedIn])

  // #F4: revoga o object-URL de preview no UNMOUNT (escolheu foto e navegou fora antes de enviar) —
  // os revokes imperativos (pick/remove/reset) cobrem a troca; este cobre o desmonte. Depende de
  // `photoPreview` pra revogar sempre a URL VIVA (a cleanup roda com o valor do render anterior).
  useEffect(() => {
    return () => {
      if (photoPreview) {
        try {
          URL.revokeObjectURL(photoPreview)
        } catch {
          // ambiente sem suporte — nada a revogar.
        }
      }
    }
  }, [photoPreview])

  // #366/#F3: aplica o corpo do GET /reviews/mine ao estado do viewer. `id`/moderação vêm daqui —
  // `myReviewId` precisa refrescar após ENVIAR (senão "Reportar" aparece na própria linha recém-criada
  // até o reload) e o flag `moderated` também.
  function applyMineBody(body: MineBody) {
    setOwnerClient(!!body.isOwner)
    setMyReviewId(body.viewerReview?.id ?? null)
    setViewerModerated(!!body.moderated)
    // #365: a foto já salva (prefill do preview de edição). O servidor é a verdade.
    setExistingPhotoUrl(body.viewerReview?.photoUrl ?? null)
    if (body.viewerReview) {
      setRating(body.viewerReview.rating)
      setComment(body.viewerReview.comment ?? '')
      setHasReview(true)
    }
  }

  /** Revoga o object-URL de preview atual (se houver) — evita vazamento ao trocar/limpar a foto. */
  function revokePreview() {
    if (photoPreview) {
      try {
        URL.revokeObjectURL(photoPreview)
      } catch {
        // ambiente sem suporte — nada a revogar.
      }
    }
  }

  /** Limpa o value do input pra permitir re-selecionar o MESMO arquivo (onChange só dispara se muda). */
  function resetPhotoInput() {
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  // #365: escolher a foto → REDIMENSIONA no client PRIMEIRO (re-encoda webp, tira EXIF no happy-path,
  // fica sob o cap de body da Vercel). Valida tipo+tamanho do resultado; heic/gif que o resize não
  // converteu caem no guard de tipo. NUNCA envia o arquivo cru — o servidor re-encoda de novo (backstop).
  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError(null)
    try {
      const blob = await resizeImage(file, { maxDim: 1024 })
      if (!ACCEPTED_PHOTO_TYPES.has(blob.type)) {
        setPhotoError(m.fotoTipoInvalido)
        resetPhotoInput()
        return
      }
      if (blob.size > MAX_PHOTO_BYTES) {
        setPhotoError(m.fotoGrande)
        resetPhotoInput()
        return
      }
      revokePreview()
      setPhotoFile(blob)
      setPhotoPreview(makeObjectUrl(blob))
      setRemovePhoto(false)
    } catch {
      setPhotoError(m.erroFoto)
    } finally {
      resetPhotoInput()
    }
  }

  /** #365: marca a foto atual pra remoção (some do preview; o envio manda `removePhoto`). */
  function onRemovePhoto() {
    revokePreview()
    setPhotoFile(null)
    setPhotoPreview(null)
    setRemovePhoto(true)
    setPhotoError(null)
  }

  /** Reseta o estado da foto após um envio bem-sucedido (o /mine traz a URL nova). */
  function resetPhotoState() {
    revokePreview()
    setPhotoFile(null)
    setPhotoPreview(null)
    setRemovePhoto(false)
    setPhotoError(null)
  }

  // Re-busca a PRÓPRIA avaliação após escrever (envio/apagar) — mantém `myReviewId`/`moderated`
  // coerentes sem reload. Silencioso na falha (o POST/DELETE já é autoritativo pro estado próprio).
  async function refreshMine() {
    if (canManage || !loggedIn) return
    try {
      const res = await fetch(`/api/recipes/${recipeId}/reviews/mine`)
      if (!res.ok) return
      applyMineBody((await res.json()) as MineBody)
    } catch {
      // silencioso.
    }
  }

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
      const trimmed = comment.trim()
      // #365: com mudança de foto (nova ou remoção) → multipart (o browser seta o boundary; NÃO
      // mandamos content-type). Sem foto → JSON, exatamente como antes (regressão preservada).
      const hasPhotoChange = photoFile != null || removePhoto
      let res: Response
      if (hasPhotoChange) {
        const fd = new FormData()
        fd.append('rating', String(rating))
        if (trimmed !== '') fd.append('comment', trimmed)
        if (photoFile) fd.append('file', photoFile, `foto.${extForPhoto(photoFile.type)}`)
        else if (removePhoto) fd.append('removePhoto', '1')
        res = await fetch(`/api/recipes/${recipeId}/reviews`, { method: 'POST', body: fd })
      } else {
        res = await fetch(`/api/recipes/${recipeId}/reviews`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rating, comment: trimmed === '' ? null : trimmed }),
        })
      }
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
      resetPhotoState()
      await refreshList()
      // #F3: refresca `myReviewId` (a linha recém-criada não deve oferecer "Reportar" a si mesma) +
      // #365: `existingPhotoUrl` (o preview de edição passa a refletir a foto recém-gravada).
      await refreshMine()
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
      // #F3: mantém `myReviewId`/`moderated` coerentes após apagar (sem reload).
      await refreshMine()
    } catch {
      setError(m.erroApagar)
    } finally {
      setBusy(false)
    }
  }

  // #366: reporta a avaliação de outra pessoa → POST /api/reviews/[reviewId]/report {reason}. Motivo
  // obrigatório (o servidor reimpõe 400). Sucesso ⇒ estado "Reportado" desabilitado. NENHUMA ação de
  // remover (só o Curador remove, na fila do painel).
  async function handleReport(reviewId: string) {
    const reason = (reportReason[reviewId] ?? '').trim()
    if (reportBusyId != null || reason.length === 0) return
    setReportBusyId(reviewId)
    setReportErrorId(null)
    try {
      const res = await fetch(`/api/reviews/${reviewId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        setReportErrorId(reviewId)
        return
      }
      setReportedIds((prev) => ({ ...prev, [reviewId]: true }))
      setReportingId(null)
    } catch {
      setReportErrorId(reviewId)
    } finally {
      setReportBusyId(null)
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

  // Widget de nota: aparece só quando logado, não-dono, resolvido — e NÃO moderado (#366: uma
  // avaliação própria moderada é só-leitura; sem estrelas/Editar/Apagar, só o aviso de remoção).
  const showWidget = !canManage && !ownerClient && loggedIn && viewerResolved && !viewerModerated
  const showRemovedNotice = !canManage && !ownerClient && loggedIn && viewerResolved && viewerModerated
  const showAnonInvite = !canManage && sessionSettled && !loggedIn

  // #365: foto a exibir no widget — o pick novo vence; senão a existente (a menos que marcada p/ remoção).
  const photoDisplaySrc = photoFile ? photoPreview : removePhoto ? null : existingPhotoUrl
  // "Remover foto" só faz sentido quando há uma foto em jogo (nova ou já salva não-removida).
  const canRemovePhoto = photoFile != null || (existingPhotoUrl != null && !removePhoto)

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
                // Roving tabindex (APG): só UM botão é tabbável — o selecionado, ou a 1ª estrela quando
                // nada foi escolhido ainda (rating 0). O resto sai da ordem de tab (as setas navegam).
                const tabbable = rating === n || (rating === 0 && n === 1)
                return (
                  <button
                    key={n}
                    ref={(el) => {
                      starRefs.current[i] = el
                    }}
                    type="button"
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={starLabel(n)}
                    tabIndex={tabbable ? 0 : -1}
                    onClick={() => setRating(n)}
                    onKeyDown={(e) => handleStarKeyDown(e, n)}
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

          {/* #365: FOTO do prato (upload/câmera, SEM IA). `capture="environment"` abre a câmera
              traseira no mobile; `accept="image/*"`. NENHUMA affordance de gerar por IA aqui. */}
          <div className="flex flex-col gap-2">
            {photoDisplaySrc && (
              <img
                src={photoDisplaySrc}
                alt={m.fotoAlt}
                className="max-h-48 w-auto rounded-md border border-border object-contain"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="secondary" size="sm">
                <label
                  className={
                    busy ? 'cursor-not-allowed opacity-70 pointer-events-none' : 'cursor-pointer'
                  }
                >
                  {photoDisplaySrc ? m.trocarFoto : m.adicionarFoto}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={onPickPhoto}
                    disabled={busy}
                    className="sr-only"
                  />
                </label>
              </Button>
              {canRemovePhoto && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onRemovePhoto}
                  disabled={busy}
                >
                  {m.removerFoto}
                </Button>
              )}
            </div>
            {photoError != null && (
              <p role="alert" className="text-xs font-medium text-foreground">
                {photoError}
              </p>
            )}
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

      {/* #366: avaliação própria MODERADA (removida pelo Curador) — aviso só-leitura no lugar do
          widget. Sem estrelas/Editar/Apagar: o delete é no-op durável no servidor (não mente). */}
      {showRemovedNotice && (
        <div className="border-t border-border pt-3">
          <p role="status" className="text-sm font-medium text-muted">
            {m.suaAvaliacaoRemovida}
          </p>
        </div>
      )}

      {/* Convite pra anônimo. */}
      {showAnonInvite && (
        <div className="border-t border-border pt-3">
          <Button asChild variant="secondary">
            <Link href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>{m.convidaEntrar}</Link>
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

              {/* #365 (#F5): FOTO do prato da avaliação — `<img>` cru contido (max-h + object-contain),
                  consistente com a convenção de avatar/recipe-image do repo; `alt` é conteúdo/prova,
                  `loading="lazy"` adia o fetch fora da tela. */}
              {r.photoUrl && (
                <img
                  src={r.photoUrl}
                  alt={m.fotoAlt}
                  loading="lazy"
                  className="mt-1 max-h-64 w-auto rounded-md border border-border object-contain"
                />
              )}

              {/* #366: "Reportar" — só logado, e nunca na própria avaliação (o autor edita/apaga; o
                  dono da receita reporta as de terceiros, NUNCA remove). O botão revela o motivo; ao
                  abrir, é SUBSTITUÍDO pelo form (Reportar=enviar + Cancelar), sem ação de remover. */}
              {loggedIn && r.id !== myReviewId && (
                <div className="mt-1 flex flex-col gap-2">
                  {reportedIds[r.id] ? (
                    <span className="text-xs font-medium text-muted">{m.reportado}</span>
                  ) : reportingId === r.id ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`report-motivo-${r.id}`}>{m.motivoReport}</Label>
                      <Textarea
                        id={`report-motivo-${r.id}`}
                        value={reportReason[r.id] ?? ''}
                        onChange={(e) =>
                          setReportReason((prev) => ({ ...prev, [r.id]: e.target.value }))
                        }
                        rows={2}
                        aria-required="true"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleReport(r.id)}
                          disabled={
                            reportBusyId === r.id || (reportReason[r.id] ?? '').trim().length === 0
                          }
                          aria-busy={reportBusyId === r.id}
                        >
                          {m.reportar}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setReportingId(null)}
                          disabled={reportBusyId === r.id}
                        >
                          {m.cancelarReport}
                        </Button>
                      </div>
                      {reportErrorId === r.id && (
                        <Alert variant="info" role="alert">
                          <AlertDescription className="font-medium text-foreground">
                            {m.erroReport}
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  ) : (
                    <div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setReportErrorId(null)
                          setReportingId(r.id)
                        }}
                        aria-expanded={false}
                      >
                        {m.reportar}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))
        )}
      </ul>
    </section>
  )
}
