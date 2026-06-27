'use client'

/**
 * Fila de cozinhas sugeridas (#320, ADR-0025 Decisão 5) — Curador+ (o servidor reforça
 * requireRole 'curador'). Consome `GET /api/curate/cozinhas` + `POST .../[slug]/{approve,merge,reject}`
 * via `fetch` (ADR-0010, NÃO Server Action). Espelha `ModerationQueue`: ações OTIMISTAS (remove o card
 * na hora) que REVERTEM no erro com mensagem neutra; sem `router.refresh()` (o estado local é a verdade).
 *
 * Este é o ÚNICO lugar do Curador que mostra o SLUG CRU sugerido (o texto "Outra" virou slug em #319).
 * Por card: APROVAR (dois rótulos pt-BR/en-US + slug canônico opcional), MESCLAR (slug da cozinha
 * ativa-alvo) e REJEITAR. O mapa de erro chaveia pelos LITERAIS EXATOS que as rotas devolvem
 * (rotulos_invalidos/slug_invalido/slug_em_uso/alvo_invalido/ja_resolvido/nao_encontrado/erro_interno)
 * → string localizada; nenhuma chave conhecida cai no genérico.
 *
 * Cores: só neutros/brand AA-verificados (sem âmbar/accent). Português-first via i18n.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SuggestedCozinhaRow } from '@/server/vocabulary/curate'

type ErrorKey =
  | 'erroRotulos'
  | 'erroSlugInvalido'
  | 'erroSlugEmUso'
  | 'erroAlvoInvalido'
  | 'erroJaResolvido'
  | 'erroNaoEncontrado'
  | 'erroGenerico'

/** Traduz o literal de erro da rota (CHAVE, nunca status) para a chave de i18n. */
function errorKeyFor(raw: string | undefined): ErrorKey {
  switch (raw) {
    case 'rotulos_invalidos':
      return 'erroRotulos'
    case 'slug_invalido':
      return 'erroSlugInvalido'
    case 'slug_em_uso':
      return 'erroSlugEmUso'
    case 'alvo_invalido':
      return 'erroAlvoInvalido'
    case 'ja_resolvido':
      return 'erroJaResolvido'
    case 'nao_encontrado':
      return 'erroNaoEncontrado'
    default:
      return 'erroGenerico'
  }
}

type Panel = 'approve' | 'merge' | null

export function CozinhaSuggestionQueue() {
  const { messages } = useLocale()
  const m = messages.filaCozinhas
  const sys = messages.system

  const [items, setItems] = useState<SuggestedCozinhaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busySlug, setBusySlug] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'approve' | 'merge' | 'reject' | null>(null)
  const [openPanel, setOpenPanel] = useState<Record<string, Panel>>({})
  const [errorSlug, setErrorSlug] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)
  // Rascunhos por slug (controlados). Chaves: ptBr/enUs/newSlug (aprovar) e target (mesclar).
  const [draft, setDraft] = useState<
    Record<string, { ptBr?: string; enUs?: string; newSlug?: string; target?: string }>
  >({})

  function field(slug: string, key: 'ptBr' | 'enUs' | 'newSlug' | 'target'): string {
    return draft[slug]?.[key] ?? ''
  }
  function setField(slug: string, key: 'ptBr' | 'enUs' | 'newSlug' | 'target', value: string) {
    setDraft((prev) => ({ ...prev, [slug]: { ...prev[slug], [key]: value } }))
  }
  function panelOf(slug: string): Panel {
    return openPanel[slug] ?? null
  }
  function togglePanel(slug: string, panel: Exclude<Panel, null>) {
    clearError()
    setOpenPanel((prev) => ({ ...prev, [slug]: prev[slug] === panel ? null : panel }))
  }

  function clearError() {
    setErrorSlug(null)
    setErrorKey(null)
  }

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/curate/cozinhas')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { cozinhas: SuggestedCozinhaRow[] }
      setItems(body.cozinhas)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Fetch num timer (não no corpo síncrono) p/ não disparar setState em cascata — padrão do repo.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  /**
   * Despacho otimista comum às 3 ações: remove o card, dispara o POST, REVERTE no erro mapeando a
   * chave. `body` é o corpo JSON da ação (vazio em rejeitar).
   */
  async function act(
    slug: string,
    action: 'approve' | 'merge' | 'reject',
    body: Record<string, string>,
  ) {
    if (busySlug) return
    setBusySlug(slug)
    setBusyAction(action)
    clearError()
    const snapshot = items
    setItems((prev) => prev.filter((it) => it.slug !== slug))
    try {
      const res = await fetch(`/api/curate/cozinhas/${encodeURIComponent(slug)}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setItems(snapshot)
        setErrorSlug(slug)
        setErrorKey(errorKeyFor(payload?.error))
      } else {
        setOpenPanel((prev) => ({ ...prev, [slug]: null }))
      }
    } catch {
      setItems(snapshot)
      setErrorSlug(slug)
      setErrorKey('erroGenerico')
    } finally {
      setBusySlug(null)
      setBusyAction(null)
    }
  }

  function handleApprove(slug: string) {
    const ptBr = field(slug, 'ptBr').trim()
    const enUs = field(slug, 'enUs').trim()
    if (ptBr.length === 0 || enUs.length === 0) return
    const newSlug = field(slug, 'newSlug').trim()
    void act(slug, 'approve', {
      labelPtBr: ptBr,
      labelEnUs: enUs,
      ...(newSlug.length > 0 ? { newSlug } : {}),
    })
  }
  function handleMerge(slug: string) {
    const target = field(slug, 'target').trim()
    if (target.length === 0) return
    void act(slug, 'merge', { target })
  }

  const busyHere = (slug: string, action: 'approve' | 'merge' | 'reject') =>
    busySlug === slug && busyAction === action

  return (
    <section aria-labelledby="fila-cozinhas-titulo" className="flex flex-col gap-3">
      <h2 id="fila-cozinhas-titulo" className="font-display text-lg font-semibold text-fg">
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
                key={item.slug}
                className="flex flex-col gap-2 rounded-md border border-border bg-surface px-4 py-3"
              >
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  <dt className="font-medium text-fg">{m.cozinha}</dt>
                  <dd className="font-mono text-muted">{item.slug}</dd>
                  <dt className="font-medium text-fg">{m.receitas}</dt>
                  <dd className="text-muted">{item.recipeCount}</dd>
                </dl>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => togglePanel(item.slug, 'approve')}
                    disabled={busySlug === item.slug}
                    aria-expanded={panelOf(item.slug) === 'approve'}
                    className="disabled:opacity-70"
                  >
                    {m.aprovar}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => togglePanel(item.slug, 'merge')}
                    disabled={busySlug === item.slug}
                    aria-expanded={panelOf(item.slug) === 'merge'}
                    className="disabled:opacity-70"
                  >
                    {m.mesclar}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void act(item.slug, 'reject', {})}
                    disabled={busySlug === item.slug}
                    aria-busy={busyHere(item.slug, 'reject')}
                    className="disabled:opacity-70"
                  >
                    {busyHere(item.slug, 'reject') ? m.rejeitando : m.rejeitar}
                  </Button>
                </div>

                {panelOf(item.slug) === 'approve' && (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.rotuloPtBr}
                      <Input
                        value={field(item.slug, 'ptBr')}
                        onChange={(e) => setField(item.slug, 'ptBr', e.target.value)}
                        aria-required="true"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.rotuloEnUs}
                      <Input
                        value={field(item.slug, 'enUs')}
                        onChange={(e) => setField(item.slug, 'enUs', e.target.value)}
                        aria-required="true"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.slugCanonico}
                      <Input
                        value={field(item.slug, 'newSlug')}
                        onChange={(e) => setField(item.slug, 'newSlug', e.target.value)}
                        placeholder={m.slugCanonicoPlaceholder}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleApprove(item.slug)}
                        disabled={
                          busySlug === item.slug ||
                          field(item.slug, 'ptBr').trim().length === 0 ||
                          field(item.slug, 'enUs').trim().length === 0
                        }
                        aria-busy={busyHere(item.slug, 'approve')}
                        className="disabled:opacity-70"
                      >
                        {busyHere(item.slug, 'approve') ? m.aprovando : m.confirmarAprovacao}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setOpenPanel((prev) => ({ ...prev, [item.slug]: null }))}
                        disabled={busySlug === item.slug}
                        className="disabled:opacity-70"
                      >
                        {m.cancelar}
                      </Button>
                    </div>
                  </div>
                )}

                {panelOf(item.slug) === 'merge' && (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                      {m.alvoMesclar}
                      <Input
                        value={field(item.slug, 'target')}
                        onChange={(e) => setField(item.slug, 'target', e.target.value)}
                        placeholder={m.alvoPlaceholder}
                        aria-required="true"
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleMerge(item.slug)}
                        disabled={
                          busySlug === item.slug || field(item.slug, 'target').trim().length === 0
                        }
                        aria-busy={busyHere(item.slug, 'merge')}
                        className="disabled:opacity-70"
                      >
                        {busyHere(item.slug, 'merge') ? m.mesclando : m.confirmarMesclagem}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setOpenPanel((prev) => ({ ...prev, [item.slug]: null }))}
                        disabled={busySlug === item.slug}
                        className="disabled:opacity-70"
                      >
                        {m.cancelar}
                      </Button>
                    </div>
                  </div>
                )}

                {errorSlug === item.slug && errorKey && (
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
