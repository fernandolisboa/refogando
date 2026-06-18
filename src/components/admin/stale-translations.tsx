'use client'

/**
 * Traduções desatualizadas (#63, AC2) — Curador+ (o servidor reforça requireRole 'curador').
 *
 * ADR-0010: consome `GET /api/curate/translations/stale` + `POST /api/recipes/[id]/
 * translations/[locale]/review` via `fetch` (NÃO Server Action). Sinalização LEVE, sem
 * bloqueio (CONTEXT.md): só Comunidade aparece (a rota já filtra). Marcar revisada é otimista
 * (remove o item) e REVERTE no erro. SEM `router.refresh()`: o estado local é autoritativo.
 *
 * Rótulo de VALOR localizado para `provenance` via lookup `satisfies Record<...>`. A chave de
 * busy é `${recipeId}:${locale}` (a tupla é a identidade, não o recipeId só). Cores: só
 * neutros/brand AA-verificados; sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { btnPrimarySm, btnSecondarySm } from '@/components/button'
import {
  TRANSLATION_PROVENANCES,
  type TranslationProvenance,
} from '@/domain/recipe'

type StaleItem = { recipeId: string; locale: string; provenance: string }

export function StaleTranslations() {
  const { messages } = useLocale()
  const m = messages.traducoesStale
  const sys = messages.system

  const [items, setItems] = useState<StaleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const provenanceLabel = {
    escrita_por_pessoa: m.provEscritaPorPessoa,
    automatica_revisada: m.provAutomaticaRevisada,
    automatica_nao_revisada: m.provAutomaticaNaoRevisada,
  } satisfies Record<TranslationProvenance, string>

  function labelProvenance(value: string): string {
    return (TRANSLATION_PROVENANCES as readonly string[]).includes(value)
      ? provenanceLabel[value as TranslationProvenance]
      : value
  }

  const itemKey = (it: StaleItem) => `${it.recipeId}:${it.locale}`

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/translations/stale')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { stale: StaleItem[] }
      setItems(body.stale)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono do effect) p/ não disparar setState em cascata
    // na montagem — mesmo padrão de `search-experience.tsx`. O retry redispara `load`.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function handleReview(item: StaleItem) {
    const key = itemKey(item)
    if (busyKey) return
    setBusyKey(key)
    setErrorKey(null)
    const snapshot = items
    setItems((prev) => prev.filter((it) => itemKey(it) !== key))
    try {
      const res = await fetch(
        `/api/recipes/${item.recipeId}/translations/${item.locale}/review`,
        { method: 'POST' },
      )
      if (!res.ok) {
        setItems(snapshot)
        setErrorKey(key)
      }
    } catch {
      setItems(snapshot)
      setErrorKey(key)
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section aria-labelledby="stale-titulo" className="flex flex-col gap-3">
      <h2 id="stale-titulo" className="font-display text-lg font-semibold text-fg">
        {m.titulo}
      </h2>

      {/* Região persistente com `aria-live`/`aria-busy`: anuncia o fim do loading e o que
          chegou (lista, vazio ou erro) a um leitor de tela que ficou na seção. O wrapper não é
          desmontado entre estados; só o conteúdo troca. Mesmo recorte de search-experience.tsx. */}
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
            <button type="button" onClick={() => void load()} className={btnPrimarySm}>
              {sys.retry}
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{m.listaVazia}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => {
              const key = itemKey(item)
              return (
                <li
                  key={key}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
                >
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium text-fg">{m.receita}</dt>
                    <dd className="truncate text-muted" title={item.recipeId}>
                      {item.recipeId}
                    </dd>
                    <dt className="font-medium text-fg">{m.idioma}</dt>
                    <dd className="text-muted">{item.locale}</dd>
                    <dt className="font-medium text-fg">{m.origem}</dt>
                    <dd className="text-muted">{labelProvenance(item.provenance)}</dd>
                  </dl>
                  <div>
                    <button
                      type="button"
                      onClick={() => void handleReview(item)}
                      disabled={busyKey === key}
                      aria-busy={busyKey === key}
                      className={`${btnSecondarySm} disabled:opacity-70`}
                    >
                      {busyKey === key ? m.marcando : m.marcarRevisada}
                    </button>
                  </div>
                  {errorKey === key && (
                    <p
                      role="alert"
                      className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
                    >
                      {m.erroGenerico}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
