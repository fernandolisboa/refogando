'use client'

/**
 * Backfill dos embeddings da busca semântica (#119) — Admin-only (a page `/admin/ai` revalida
 * `min='admin'`; a API `/api/admin/embeddings/recompute` reforça `requireRole 'admin'`). Recomputa,
 * em lote capado, os vetores das receitas que ainda não têm — para as nascidas antes do pipeline de
 * embedding-na-criação. Idempotente e RETOMÁVEL: a rota devolve `{ recomputed, remaining }`; o admin
 * clica até `faltam: 0`. Requer a key de embedding no ambiente (gate humano).
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch` (NÃO Server Action). Sem carga inicial (POST-only).
 * Cores: só tokens AA-verificados (#54).
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

type BackfillResult = { recomputed: number; remaining: number; error?: string }

export function EmbeddingBackfill() {
  const { messages } = useLocale()
  const m = messages.admin

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [errored, setErrored] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    setErrored(false)
    try {
      const res = await fetch('/api/admin/embeddings/recompute', { method: 'POST' })
      if (!res.ok) {
        setErrored(true)
        return
      }
      setResult((await res.json()) as BackfillResult)
    } catch {
      setErrored(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="backfill-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="backfill-titulo" className="font-display text-lg font-semibold text-fg">
          {m.backfillTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.backfillDescricao}</p>
      </div>

      <Button
        type="button"
        size="sm"
        onClick={() => void run()}
        disabled={busy}
        aria-busy={busy}
        className="self-start disabled:opacity-70"
      >
        {busy ? m.backfillRodando : m.backfillBtn}
      </Button>

      <div aria-live="polite" className="text-sm">
        {errored && (
          <p
            role="alert"
            className="rounded-md border border-border bg-bg px-3 py-2 font-medium text-fg"
          >
            {m.backfillErro}
          </p>
        )}
        {result && !errored && (
          <p role="status" className="font-medium text-fg">
            {(result.error ? m.backfillResultadoParcial : m.backfillResultado)
              .replace('{recomputados}', String(result.recomputed))
              .replace('{restantes}', String(result.remaining))}
          </p>
        )}
      </div>
    </section>
  )
}
