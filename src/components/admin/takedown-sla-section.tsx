'use client'

/**
 * Painel de SLA de takedown / DSAR (#412, GAP-7) — admin-only (a page `/admin/descoberta` revalida
 * `min='admin'` server-side; a API `GET /api/admin/takedown-sla` reforça `requireRole 'admin'`).
 *
 * Lê os tickets ABERTOS (a rota já EXCLUI os resolvidos — fulfilled/rejected — pela fonte única
 * `RESOLVED_TAKEDOWN_STATUSES`) e os apresenta ordenados por URGÊNCIA: o `sla_level` de maior rank
 * (overdue → red → yellow → none) no topo, e dentro do mesmo nível o mais VELHO primeiro. A idade em
 * dias é recomputada no cliente com `ticketAgeDays` (kernel puro), `now = new Date()`. Cada ticket tem
 * as ações de ENCERRAR ("atendido" / "recusar" com motivo) via `POST /api/admin/takedown-sla/resolve`;
 * o ticket encerrado sai da lista (a rota o grava como fulfilled/rejected + evento de auditoria). Cores só via tokens AA (#54): amarelo = `aviso`; red/overdue = o token
 * de perigo `destructive` — sempre com RÓTULO textual (o nível nunca é comunicado só por cor).
 *
 * Espelha `stale-translations.tsx`: fetch num timer, região `aria-live`/`aria-busy` persistente,
 * estados loading/erro(+retry)/vazio/lista. Copy via `useLocale().messages.admin.*`.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import {
  isSlaLevel,
  slaLevelRank,
  ticketAgeDays,
  type SlaLevel,
} from '@/domain/dsar-sla'

type Ticket = {
  id: string
  requestType: string
  sourceUrl: string | null
  displayName: string | null
  message: string
  receivedAt: string
  slaLevel: string
}

export function TakedownSlaSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Encerramento: qual ticket está com a requisição em voo, qual está com o campo de motivo aberto
  // (recusa), o texto do motivo e qual ticket teve erro na última tentativa.
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [errorId, setErrorId] = useState<string | null>(null)

  async function resolve(ticketId: string, resolution: 'fulfilled' | 'rejected') {
    setPendingId(ticketId)
    setErrorId(null)
    try {
      const res = await fetch('/api/admin/takedown-sla/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          resolution === 'rejected' ? { ticketId, resolution, reason } : { ticketId, resolution },
        ),
      })
      // 409 = já encerrado (outra aba/operador): o ticket some da lista do mesmo jeito.
      if (!res.ok && res.status !== 409) {
        setErrorId(ticketId)
        return
      }
      setTickets((prev) => prev.filter((t) => t.id !== ticketId))
      setRejectingId(null)
      setReason('')
    } catch {
      setErrorId(ticketId)
    } finally {
      setPendingId(null)
    }
  }

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/takedown-sla')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { tickets: Ticket[] }
      setTickets(body.tickets)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono) p/ não disparar setState em cascata na montagem —
    // mesmo padrão de stale-translations.tsx / search-experience.tsx. O retry redispara `load`.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  const requestTypeLabel = {
    name_removal: m.slaTipoNameRemoval,
    full_removal: m.slaTipoFullRemoval,
    other: m.slaTipoOther,
  } as const

  function labelRequestType(value: string): string {
    return value in requestTypeLabel
      ? requestTypeLabel[value as keyof typeof requestTypeLabel]
      : value
  }

  const levelLabel: Record<SlaLevel, string> = {
    none: m.slaNivelNone,
    yellow: m.slaNivelYellow,
    red: m.slaNivelRed,
    overdue: m.slaNivelOverdue,
  }

  // Classe do badge por nível: só tokens. Amarelo = `aviso`; red/overdue = perigo `destructive`
  // (solid p/ overdue, contorno p/ red); none = neutro. O rótulo textual acompanha SEMPRE.
  const levelBadgeClass: Record<SlaLevel, string> = {
    none: 'border border-border text-muted',
    yellow: 'bg-aviso-bg text-aviso-fg',
    red: 'border border-destructive text-destructive',
    overdue: 'bg-destructive text-destructive-foreground',
  }

  const now = new Date()

  // Ordena por URGÊNCIA: rank do nível DESC (overdue no topo), empate → mais velho primeiro (idade DESC).
  const ordered = [...tickets].sort((a, b) => {
    const la = isSlaLevel(a.slaLevel) ? a.slaLevel : 'none'
    const lb = isSlaLevel(b.slaLevel) ? b.slaLevel : 'none'
    const byRank = slaLevelRank(lb) - slaLevelRank(la)
    if (byRank !== 0) return byRank
    return ticketAgeDays(new Date(b.receivedAt), now) - ticketAgeDays(new Date(a.receivedAt), now)
  })

  return (
    <section aria-labelledby="sla-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="sla-titulo" className="font-display text-lg font-semibold text-fg">
          {m.slaTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.slaDescricao}</p>
      </div>

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
        ) : ordered.length === 0 ? (
          <p className="text-sm text-muted">{m.slaVazio}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((t) => {
              const level: SlaLevel = isSlaLevel(t.slaLevel) ? t.slaLevel : 'none'
              const ageDays = ticketAgeDays(new Date(t.receivedAt), now)
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${levelBadgeClass[level]}`}
                    >
                      {levelLabel[level]}
                    </span>
                    <span className="text-sm font-medium text-fg">
                      {m.slaIdadeDias.replace('{dias}', String(ageDays))}
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-medium text-fg">{m.slaTipoLabel}</dt>
                    <dd className="text-muted">{labelRequestType(t.requestType)}</dd>

                    <dt className="font-medium text-fg">{m.slaFonteLabel}</dt>
                    <dd className="text-muted">
                      {t.displayName ?? t.sourceUrl ?? m.slaSemFonte}
                    </dd>

                    {t.sourceUrl && t.displayName ? (
                      <>
                        <dt className="font-medium text-fg">{m.slaUrlLabel}</dt>
                        <dd className="truncate font-mono text-muted" title={t.sourceUrl}>
                          {t.sourceUrl}
                        </dd>
                      </>
                    ) : null}

                    <dt className="font-medium text-fg">{m.slaMensagemLabel}</dt>
                    <dd className="text-muted">{t.message}</dd>

                    <dt className="font-medium text-fg">{m.slaRecebidoLabel}</dt>
                    <dd className="text-muted">{new Date(t.receivedAt).toLocaleDateString()}</dd>
                  </dl>

                  {rejectingId === t.id ? (
                    <div className="flex flex-col gap-2">
                      <label htmlFor={`sla-motivo-${t.id}`} className="text-sm font-medium text-fg">
                        {m.slaMotivoLabel}
                      </label>
                      <input
                        id={`sla-motivo-${t.id}`}
                        type="text"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full max-w-md rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={pendingId === t.id || reason.trim() === ''}
                          aria-busy={pendingId === t.id}
                          onClick={() => void resolve(t.id, 'rejected')}
                        >
                          {m.slaConfirmarRecusa}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={pendingId === t.id}
                          onClick={() => {
                            setRejectingId(null)
                            setReason('')
                          }}
                        >
                          {m.slaCancelar}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={pendingId === t.id}
                        aria-busy={pendingId === t.id}
                        onClick={() => void resolve(t.id, 'fulfilled')}
                      >
                        {m.slaMarcarAtendido}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pendingId === t.id}
                        onClick={() => {
                          setRejectingId(t.id)
                          setReason('')
                          setErrorId(null)
                        }}
                      >
                        {m.slaRecusar}
                      </Button>
                    </div>
                  )}
                  {errorId === t.id ? (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {m.slaEncerrarErro}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
