'use client'

/**
 * Fila PROATIVA do Curador (#227, ADR-0022 dec.3) — Curador+ (o servidor reforça requireRole
 * 'curador'). Surfa as gerações por IA COM refino do autor (`recipe_image.review_required`).
 *
 * É PROATIVA e NÃO-BLOQUEANTE (default-open INTACTO, ADR-0020): a imagem segue PÚBLICA — esta fila
 * só MONITORA. Duas ações, AMBAS tirando o card da fila (otimista, revertem no erro):
 *  - REMOVER (`POST .../[imageId]/remove`, motivo OBRIGATÓRIO): modera a imagem (#133) — esconde do
 *    público (placeholder). Eixo destrutivo ⇒ secundário, com painel de motivo.
 *  - DISPENSAR (`POST .../[imageId]/dismiss`, sem corpo): julgou OK — zera a flag; a imagem fica
 *    pública. Ação benigna ⇒ primária.
 *
 * ADR-0010: consome a API via `fetch` (NÃO Server Action). SEM `router.refresh()`: o estado local é
 * autoritativo (nada na árvore server deriva da fila). Espelha `moderation-queue.tsx`. `createdAt`
 * chega como STRING ISO (não renderizamos data ⇒ nunca chamamos método de Date). Cores: só
 * neutros/brand AA — sem token destrutivo (decisão de design; espelha a fila de moderação).
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ReviewQueueItem } from '@/server/curate/review'

/** A fila chega via `res.json()` ⇒ `createdAt` vira STRING ISO (não Date). */
type ReviewQueueItemJson = Omit<ReviewQueueItem, 'createdAt'> & { createdAt: string }

export function ReviewQueue() {
  const { locale, messages } = useLocale()
  const m = messages.revisaoImagens
  const sys = messages.system

  const [items, setItems] = useState<ReviewQueueItemJson[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'remove' | 'dismiss' | null>(null)
  const [errorId, setErrorId] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<'erroMotivo' | 'erroNaoEncontrada' | 'erroGenerico' | null>(
    null,
  )
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/review-images')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { images: ReviewQueueItemJson[] }
      setItems(body.images)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono do effect) p/ não disparar setState em cascata na
    // montagem — mesmo padrão de moderation-queue.tsx. O retry redispara `load`.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  function clearError() {
    setErrorId(null)
    setErrorKey(null)
  }

  async function handleRemove(item: ReviewQueueItemJson) {
    const reason = (reasonDraft[item.imageId] ?? '').trim()
    if (busyId || reason.length === 0) return
    setBusyId(item.imageId)
    setBusyAction('remove')
    clearError()
    const snapshot = items
    setItems((prev) => prev.filter((it) => it.imageId !== item.imageId))
    try {
      const res = await fetch(`/api/curate/review-images/${item.imageId}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorId(item.imageId)
        setErrorKey(
          body?.error === 'dados_invalidos'
            ? 'erroMotivo'
            : body?.error === 'not_found'
              ? 'erroNaoEncontrada'
              : 'erroGenerico',
        )
      } else {
        setRemovingId(null)
      }
    } catch {
      setItems(snapshot)
      setErrorId(item.imageId)
      setErrorKey('erroGenerico')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  async function handleDismiss(item: ReviewQueueItemJson) {
    if (busyId) return
    setBusyId(item.imageId)
    setBusyAction('dismiss')
    clearError()
    const snapshot = items
    setItems((prev) => prev.filter((it) => it.imageId !== item.imageId))
    try {
      const res = await fetch(`/api/curate/review-images/${item.imageId}/dismiss`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorId(item.imageId)
        setErrorKey(body?.error === 'not_found' ? 'erroNaoEncontrada' : 'erroGenerico')
      }
    } catch {
      setItems(snapshot)
      setErrorId(item.imageId)
      setErrorKey('erroGenerico')
    } finally {
      setBusyId(null)
      setBusyAction(null)
    }
  }

  return (
    <section aria-labelledby="revisao-imagens-titulo" className="flex flex-col gap-3">
      <h2 id="revisao-imagens-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>
      <p className="text-sm text-muted">{m.descricao}</p>

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-3">
        {loading ? (
          <p className="text-sm text-muted">{sys.loading}</p>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-2">
            <p
              role="alert"
              className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
            >
              {sys.error}
            </p>
            <Button type="button" size="sm" onClick={() => void load()}>
              {sys.retry}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{m.filaVazia}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li
                key={item.imageId}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-start gap-3">
                  {/* Thumbnail da imagem refinada. `alt` vazio: é decorativa (o contexto textual ao
                      lado já descreve). next/image evitado de propósito (blob externo + jsdom). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-md border border-border object-cover"
                  />
                  <div className="flex flex-col gap-1">
                    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                      <dt className="font-medium text-fg">{m.receita}</dt>
                      <dd className="text-muted">
                        {item.recipeTitle ?? <span className="italic">{m.semReceita}</span>}
                      </dd>
                      {item.ownerName != null && (
                        <>
                          <dt className="font-medium text-fg">{m.autor}</dt>
                          <dd className="text-muted">{item.ownerName}</dd>
                        </>
                      )}
                    </dl>
                    {/* Selo "gerada com refino" — o porquê de a imagem estar na fila proativa. */}
                    <span className="text-sm text-muted">{m.refinada}</span>
                  </div>
                </div>

                {item.recipeId != null && (
                  <a
                    href={`/${locale}/recipes/${item.recipeId}`}
                    className="text-sm font-medium text-fg underline underline-offset-2"
                  >
                    {m.abrirReceita}
                  </a>
                )}

                {/* Dispensar (benigna/encorajada) → primário; Remover (esconde do público) →
                    secundário, revela o painel de motivo. Espelha a assimetria de peso da fila de
                    moderação (sem token de cor destrutiva — decisão de design). */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleDismiss(item)}
                    disabled={busyId === item.imageId}
                    aria-busy={busyId === item.imageId && busyAction === 'dismiss'}
                    className="disabled:opacity-70"
                  >
                    {busyId === item.imageId && busyAction === 'dismiss' ? m.dispensando : m.dispensar}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      clearError()
                      setRemovingId(removingId === item.imageId ? null : item.imageId)
                    }}
                    disabled={busyId === item.imageId}
                    aria-expanded={removingId === item.imageId}
                    className="disabled:opacity-70"
                  >
                    {m.remover}
                  </Button>
                </div>

                {removingId === item.imageId && (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.motivoRemocao}
                      <Textarea
                        value={reasonDraft[item.imageId] ?? ''}
                        onChange={(e) =>
                          setReasonDraft((prev) => ({ ...prev, [item.imageId]: e.target.value }))
                        }
                        placeholder={m.motivoPlaceholder}
                        aria-required="true"
                        rows={2}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleRemove(item)}
                        disabled={
                          busyId === item.imageId ||
                          (reasonDraft[item.imageId] ?? '').trim().length === 0
                        }
                        aria-busy={busyId === item.imageId && busyAction === 'remove'}
                        className="disabled:opacity-70"
                      >
                        {busyId === item.imageId && busyAction === 'remove'
                          ? m.removendo
                          : m.confirmarRemocao}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setRemovingId(null)}
                        disabled={busyId === item.imageId}
                        className="disabled:opacity-70"
                      >
                        {m.cancelar}
                      </Button>
                    </div>
                  </div>
                )}

                {errorId === item.imageId && errorKey && (
                  <p
                    role="alert"
                    className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
                  >
                    {m[errorKey]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
