'use client'

/**
 * Re-tradução das traduções defasadas (#499, ADR-0031 dec.5) — Admin-only (a page
 * `/admin/descoberta` revalida `min='admin'`; a API `/api/admin/translations/retranslate`
 * reforça `requireRole 'admin'`). Re-traduz, em lote capado, as traduções DERIVADAS
 * defasadas-e-intocadas (o original mudou OU o tradutor melhorou, e ninguém editou à mão desde a
 * última MT). Idempotente e RETOMÁVEL: a rota devolve `{ retranslated, degraded, remaining }`; o
 * admin clica até `faltam: 0`. Espelha `EmbeddingBackfill` (mesma UX, mesmo padrão de fetch).
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch` (NÃO Server Action). Sem carga inicial (POST-only).
 * Cores: só tokens AA-verificados (#54).
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

type RetranslateResult = { retranslated: number; degraded: number; remaining: number }

export function TranslationRetranslate() {
  const { messages } = useLocale()
  const m = messages.admin

  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RetranslateResult | null>(null)
  const [errored, setErrored] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    setErrored(false)
    try {
      const res = await fetch('/api/admin/translations/retranslate', { method: 'POST' })
      if (!res.ok) {
        setErrored(true)
        return
      }
      setResult((await res.json()) as RetranslateResult)
    } catch {
      setErrored(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="retranslate-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="retranslate-titulo" className="font-display text-lg font-semibold text-fg">
          {m.retranslateTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.retranslateDescricao}</p>
      </div>

      <Button
        type="button"
        size="sm"
        onClick={() => void run()}
        disabled={busy}
        aria-busy={busy}
        className="self-start disabled:opacity-70"
      >
        {busy ? m.retranslateRodando : m.retranslateBtn}
      </Button>

      <div aria-live="polite" className="text-sm">
        {errored && (
          <p
            role="alert"
            className="rounded-md border border-border bg-bg px-3 py-2 font-medium text-fg"
          >
            {m.retranslateErro}
          </p>
        )}
        {result && !errored && (
          <p role="status" className="font-medium text-fg">
            {m.retranslateResultado
              .replace('{retraduzidas}', String(result.retranslated))
              .replace('{puladas}', String(result.degraded))
              .replace('{restantes}', String(result.remaining))}
          </p>
        )}
      </div>
    </section>
  )
}
