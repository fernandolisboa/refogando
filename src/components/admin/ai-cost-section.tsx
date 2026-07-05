'use client'

/**
 * Painel de CUSTO de IA (#465) — Admin-only (a page `/admin/ia`, aba "IA", revalida `min='admin'`
 * server-side; a API `GET /api/admin/ai-cost` reforça `requireRole 'admin'`). Read-only: agrega os DOIS
 * ledgers de custo já existentes — texto (`generation`, #463) e imagem (`image_generation`, #224) — em
 * três vistas: custo/dia, custo/usuário top-N e custo do texto por desfecho (Receita salva/avaliada).
 *
 * ADR-0010: consome o ROUTE HANDLER via `fetch` (NÃO Server Action). O servidor é a verdade — a
 * agregação e a janela vivem lá; aqui só renderizamos o que a rota devolve. Espelha `TakedownSlaSection`:
 * fetch num timer, região `aria-live`/`aria-busy`, estados loading/erro(+retry)/vazio. Copy via
 * `useLocale().messages.admin.*`. Valores USD já vêm em número; `formatUsd` os exibe (puro).
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { formatUsd, type AiCostSummary } from '@/domain/ai-cost-read'

export function AiCostSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [data, setData] = useState<AiCostSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/ai-cost')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      setData((await res.json()) as AiCostSummary)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono) — mesmo padrão de takedown-sla/stale-translations.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  const days = data?.windowDays ?? 0
  const withDays = (s: string) => s.replace('{dias}', String(days))
  const withN = (s: string, n: number) => s.replace('{n}', String(n))

  return (
    <section aria-labelledby="custo-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="custo-titulo" className="font-display text-lg font-semibold text-fg">
          {m.custoTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{withDays(m.custoDescricao)}</p>
      </div>

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-6">
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
        ) : data == null ? null : (
          <>
            {/* Totais da janela */}
            <div className="flex flex-wrap gap-4">
              <Tile label={m.custoTotalTexto} value={formatUsd(data.totals.textUsd)} />
              <Tile label={m.custoTotalImagem} value={formatUsd(data.totals.imageUsd)} />
              <Tile label={m.custoTotalGeral} value={formatUsd(data.totals.totalUsd)} strong />
            </div>

            {/* Custo do texto por desfecho */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">{m.custoDesfechoTitulo}</h3>
              <p className="max-w-[60ch] text-xs text-muted">{m.custoDesfechoDescricao}</p>
              <div className="flex flex-wrap gap-4">
                <Tile
                  label={m.custoDesfechoTotal}
                  value={formatUsd(data.byOutcome.totalUsd)}
                  sub={withN(m.custoContagem, data.byOutcome.totalCount)}
                />
                <Tile
                  label={m.custoDesfechoSalvos}
                  value={formatUsd(data.byOutcome.savedUsd)}
                  sub={withN(m.custoContagem, data.byOutcome.savedCount)}
                />
                <Tile
                  label={m.custoDesfechoAvaliados}
                  value={formatUsd(data.byOutcome.starredUsd)}
                  sub={withN(m.custoContagem, data.byOutcome.starredCount)}
                />
              </div>
            </div>

            {/* Custo/usuário top-N */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">{m.custoUsuariosTitulo}</h3>
              {data.topUsers.length === 0 ? (
                <p className="text-sm text-muted">{m.custoUsuariosVazio}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted">
                        <th scope="col" className="py-1 pr-4 font-medium">{m.custoUsuarioCol}</th>
                        <th scope="col" className="py-1 pr-4 text-right font-medium">{m.custoTotalTexto}</th>
                        <th scope="col" className="py-1 pr-4 text-right font-medium">{m.custoTotalImagem}</th>
                        <th scope="col" className="py-1 text-right font-medium">{m.custoTotalGeral}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topUsers.map((u) => (
                        <tr key={u.userId} className="border-b border-border/50">
                          <td className="py-1 pr-4 text-fg">{u.handle ? `@${u.handle}` : u.email}</td>
                          <td className="py-1 pr-4 text-right tabular-nums text-muted">{formatUsd(u.textUsd)}</td>
                          <td className="py-1 pr-4 text-right tabular-nums text-muted">{formatUsd(u.imageUsd)}</td>
                          <td className="py-1 text-right font-medium tabular-nums text-fg">{formatUsd(u.totalUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Custo por dia */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg">{m.custoDiaTitulo}</h3>
              {data.perDay.length === 0 ? (
                <p className="text-sm text-muted">{m.custoDiaVazio}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[24rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted">
                        <th scope="col" className="py-1 pr-4 font-medium">{m.custoDiaData}</th>
                        <th scope="col" className="py-1 pr-4 text-right font-medium">{m.custoTotalTexto}</th>
                        <th scope="col" className="py-1 pr-4 text-right font-medium">{m.custoTotalImagem}</th>
                        <th scope="col" className="py-1 text-right font-medium">{m.custoTotalGeral}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.perDay.map((d) => (
                        <tr key={d.day} className="border-b border-border/50">
                          <td className="py-1 pr-4 tabular-nums text-fg">{d.day}</td>
                          <td className="py-1 pr-4 text-right tabular-nums text-muted">{formatUsd(d.textUsd)}</td>
                          <td className="py-1 pr-4 text-right tabular-nums text-muted">{formatUsd(d.imageUsd)}</td>
                          <td className="py-1 text-right font-medium tabular-nums text-fg">
                            {formatUsd(d.textUsd + d.imageUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Cartão de número (label + valor + subtítulo opcional). Só tokens AA (#54); sem cor semântica. */
function Tile({
  label,
  value,
  sub,
  strong,
}: {
  label: string
  value: string
  sub?: string
  strong?: boolean
}) {
  return (
    <div className="flex min-w-[8rem] flex-col gap-0.5 rounded-md border border-border bg-bg px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-lg font-semibold text-fg' : 'text-base text-fg'}`}>
        {value}
      </span>
      {sub ? <span className="text-xs text-muted">{sub}</span> : null}
    </div>
  )
}
