'use client'

/**
 * Fila de CURADORIA de RECEITAS de catálogo (#238, ADR-0026) — Curador+ (o servidor reforça
 * requireRole 'curador' em cada rota). Surfa os RASCUNHOS gerados por IA (`curation_status` pending/
 * editing, owner-null) que ficam ESCONDIDOS até o dono decidir. É um GATE DE PRÉ-PUBLICAÇÃO
 * (bloqueante) — distinto da fila proativa de imagens (não-bloqueante).
 *
 * Ações (otimistas, revertem no erro; consumidas via `fetch`, NÃO Server Action — ADR-0010):
 *  - APROVAR (`POST .../[id]/approve`): vai ao público + selo editorial + promove o original locale.
 *  - REJEITAR (`POST .../[id]/reject`, nota opcional): tombstone — guardado, nunca público, some da
 *    fila ativa e entra em "Rejeitadas".
 *  - RESTAURAR (`POST .../[id]/unreject`): traz um rejeitado de volta à fila.
 *
 * SEM `router.refresh()`: o estado local é autoritativo. `createdAt` chega como STRING (não Date).
 * Cores: só neutros/brand AA (espelha as outras filas do Curador).
 */
import { useEffect, useMemo, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useCozinhaVocab } from '@/components/i18n/cozinha-vocab-provider'
import { CATEGORIAS, type Categoria } from '@/domain/vocabulary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CatalogQueueItem } from '@/server/curate/recipe-curation'

/** A fila chega via `res.json()` ⇒ `createdAt` vira STRING (não renderizamos data). */
type QueueItem = Omit<CatalogQueueItem, 'createdAt'> & { createdAt: string }

/** Corpo do rascunho carregado sob demanda (GET curador-aware) p/ o Curador VER antes de decidir. */
type DraftDetail = {
  translations: { locale: string; titulo: string; descricao: string | null; passos: string[] | null; notas: string | null }[]
  ingredientes: { rawText: string | null; quantidade: string | null; unidade: string | null }[]
}

export function CatalogRecipeQueue() {
  const { messages } = useLocale()
  const m = messages.curadoria
  const sys = messages.system

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [rejected, setRejected] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [errorId, setErrorId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, DraftDetail>>({})
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  // #238 follow-up: filtro (cozinha/categoria) + busca por título + paginação "Ver mais" — com 225
  // pendentes a lista era um scroll enorme. Filtragem CLIENT-SIDE (a fila é só-metadados, ≤225 itens,
  // e encolhe ao curar): instantâneo, sem round-trip. cozinha/categoria via vocabulário data-driven.
  const cozinhaVocab = useCozinhaVocab()
  const cozLabel = useMemo(() => new Map(cozinhaVocab.map((c) => [c.value, c.label])), [cozinhaVocab])
  const [cozinhaFilter, setCozinhaFilter] = useState('')
  const [categoriaFilter, setCategoriaFilter] = useState('')
  const [search, setSearch] = useState('')
  const PAGE = 20
  const [visibleCount, setVisibleCount] = useState(PAGE)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/recipes/queue')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { queue: QueueItem[]; rejected: QueueItem[] }
      setQueue(body.queue)
      setRejected(body.rejected)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function act(id: string, url: string, onOk: () => void): Promise<void> {
    if (busyId) return
    setBusyId(id)
    setErrorId(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!res.ok) {
        setErrorId(id)
        return
      }
      onOk()
    } catch {
      setErrorId(id)
    } finally {
      setBusyId(null)
    }
  }

  async function approve(item: QueueItem): Promise<void> {
    await act(item.recipeId, `/api/curate/recipes/${item.recipeId}/approve`, () => {
      setQueue((prev) => prev.filter((q) => q.recipeId !== item.recipeId))
    })
  }

  async function confirmReject(item: QueueItem): Promise<void> {
    if (busyId) return
    setBusyId(item.recipeId)
    setErrorId(null)
    try {
      const res = await fetch(`/api/curate/recipes/${item.recipeId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: note.trim() || null }),
      })
      if (!res.ok) {
        setErrorId(item.recipeId)
        return
      }
      const rejectedNote = note.trim() || null
      setQueue((prev) => prev.filter((q) => q.recipeId !== item.recipeId))
      setRejected((prev) => [{ ...item, curationStatus: 'rejected', reviewNote: rejectedNote }, ...prev])
      setRejectingId(null)
      setNote('')
    } catch {
      setErrorId(item.recipeId)
    } finally {
      setBusyId(null)
    }
  }

  async function restore(item: QueueItem): Promise<void> {
    await act(item.recipeId, `/api/curate/recipes/${item.recipeId}/unreject`, () => {
      setRejected((prev) => prev.filter((q) => q.recipeId !== item.recipeId))
      setQueue((prev) => [...prev, { ...item, curationStatus: 'pending', reviewNote: null }])
    })
  }

  async function toggleExpand(id: string): Promise<void> {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    if (detail[id]) return
    setDetailLoading(id)
    try {
      const res = await fetch(`/api/curate/recipes/${id}`)
      if (res.ok) {
        const body = (await res.json()) as DraftDetail
        setDetail((prev) => ({ ...prev, [id]: body }))
      }
    } catch {
      // silencioso — o bloco mostra "—" se não carregar; o Curador pode reabrir.
    } finally {
      setDetailLoading(null)
    }
  }

  function meta(item: QueueItem): string {
    return [
      item.cozinha && `${m.filaCozinha}: ${cozLabel.get(item.cozinha) ?? item.cozinha}`,
      item.categoria && `${m.filaCategoria}: ${messages.categoriaLabel[item.categoria as Categoria]}`,
      item.porcoes != null && `${m.filaPorcoes}: ${item.porcoes}`,
      item.dificuldade != null && `${m.filaDificuldade}: ${item.dificuldade}`,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const filtered = queue.filter(
    (q) =>
      (!cozinhaFilter || q.cozinha === cozinhaFilter) &&
      (!categoriaFilter || q.categoria === categoriaFilter) &&
      (!search.trim() || (q.titulo ?? '').toLowerCase().includes(search.trim().toLowerCase())),
  )
  const shown = filtered.slice(0, visibleCount)

  /** Muda um filtro/busca e RESETA a paginação ("Ver mais") pra a 1ª página do novo recorte. */
  function onFilter(setter: (v: string) => void, v: string): void {
    setter(v)
    setVisibleCount(PAGE)
  }
  const selectCls = 'rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg'

  return (
    <section aria-labelledby="catalog-queue-titulo" className="flex flex-col gap-4">
      <h3 id="catalog-queue-titulo" className="text-base font-semibold text-fg">
        {m.filaTitulo}
      </h3>

      {!loading && !loadError && queue.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={m.filaCozinha}
            value={cozinhaFilter}
            onChange={(e) => onFilter(setCozinhaFilter, e.target.value)}
            className={selectCls}
          >
            <option value="">{m.filtroTodasCozinhas}</option>
            {cozinhaVocab.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label={m.filaCategoria}
            value={categoriaFilter}
            onChange={(e) => onFilter(setCategoriaFilter, e.target.value)}
            className={selectCls}
          >
            <option value="">{m.filtroTodasCategorias}</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {messages.categoriaLabel[c]}
              </option>
            ))}
          </select>
          <Input
            type="search"
            aria-label={m.filtroBusca}
            placeholder={m.filtroBusca}
            value={search}
            onChange={(e) => onFilter(setSearch, e.target.value)}
            className="w-44"
          />
          <span className="text-xs text-muted">
            {filtered.length} {m.filaContagem}
          </span>
        </div>
      )}

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-2">
        {loading ? (
          <p className="text-sm text-muted">{sys.loading}</p>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg">
              {sys.error}
            </p>
            <Button type="button" size="sm" onClick={() => void load()}>
              {sys.retry}
            </Button>
          </div>
        ) : queue.length === 0 ? (
          <p className="text-sm text-muted">{m.filaVazia}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted">{m.filaSemFiltro}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((item) => (
              <li
                key={item.recipeId}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
              >
                <span className="text-sm text-fg">
                  <span className="font-medium">{item.titulo ?? '—'}</span>
                </span>
                <span className="text-xs text-muted">{meta(item)}</span>
                {expandedId === item.recipeId &&
                  (() => {
                    const d = detail[item.recipeId]
                    const t = d?.translations.find((x) => x.locale === item.locale) ?? d?.translations[0]
                    if (detailLoading === item.recipeId && !d) {
                      return <p className="text-sm text-muted">{sys.loading}</p>
                    }
                    return (
                      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg px-3 py-2 text-sm">
                        {t?.descricao && <p className="text-fg">{t.descricao}</p>}
                        {d && d.ingredientes.length > 0 && (
                          <div>
                            <p className="font-medium text-fg">{m.filaIngredientes}</p>
                            <ul className="list-disc pl-5 text-muted">
                              {d.ingredientes.map((ing, i) => (
                                <li key={i}>{ing.rawText ?? '—'}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {t?.passos && t.passos.length > 0 && (
                          <div>
                            <p className="font-medium text-fg">{m.filaPreparo}</p>
                            <ol className="list-decimal pl-5 text-muted">
                              {t.passos.map((p, i) => (
                                <li key={i}>{p}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                {rejectingId === item.recipeId ? (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      aria-label={m.filaRejeitarNota}
                      placeholder={m.filaRejeitarNota}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void confirmReject(item)}
                        disabled={busyId === item.recipeId}
                        aria-busy={busyId === item.recipeId}
                      >
                        {busyId === item.recipeId ? m.filaRejeitando : m.filaRejeitarConfirmar}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRejectingId(null)
                          setNote('')
                        }}
                      >
                        {m.filaRejeitarCancelar}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void approve(item)}
                      disabled={busyId === item.recipeId}
                      aria-busy={busyId === item.recipeId}
                    >
                      {busyId === item.recipeId ? m.filaAprovando : m.filaAprovar}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRejectingId(item.recipeId)
                        setNote('')
                        setErrorId(null)
                      }}
                    >
                      {m.filaRejeitar}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void toggleExpand(item.recipeId)}>
                      {expandedId === item.recipeId ? m.filaOcultar : m.filaVer}
                    </Button>
                  </div>
                )}
                {errorId === item.recipeId && (
                  <p role="alert" className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg">
                    {m.filaErro}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!loading && !loadError && filtered.length > visibleCount && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => setVisibleCount((v) => v + PAGE)}
        >
          {m.filaVerMais} ({filtered.length - visibleCount})
        </Button>
      )}

      {/* Rejeitadas (tombstones) — rever / restaurar à fila. */}
      <details className="flex flex-col gap-2">
        <summary className="cursor-pointer text-sm font-semibold text-fg">
          {m.filaRejeitadasTitulo}
          {rejected.length > 0 ? ` (${rejected.length})` : ''}
        </summary>
        {rejected.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{m.filaRejeitadasVazia}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {rejected.map((item) => (
              <li
                key={item.recipeId}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-sm text-fg">
                  <span className="font-medium">{item.titulo ?? '—'}</span>
                  {item.reviewNote && <span className="text-muted">{` · ${item.reviewNote}`}</span>}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void restore(item)}
                  disabled={busyId === item.recipeId}
                  aria-busy={busyId === item.recipeId}
                >
                  {busyId === item.recipeId ? m.filaRestaurando : m.filaRestaurar}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  )
}
