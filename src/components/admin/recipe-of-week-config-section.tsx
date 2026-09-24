'use client'

/**
 * "Receita da semana" (#457) — Admin-only. Vive em `/admin/catalog` (Curadoria, `min='curador'`),
 * mas renderizada SÓ pra admin (mesmo gate condicional de `CatalogDisclosureConfigSection`): a API
 * `/api/admin/config` reforça `requireRole 'admin'`.
 *
 * Padrão de BUSCA + ESCOLHA espelha `roles-section.tsx` (#269): o Curador digita um título (em vez
 * de colar um uuid), busca via `GET /api/admin/catalog/highlight-search?q=` (restrita ao catálogo
 * APROVADO — a API 400 recusaria qualquer outro id na hora de salvar), escolhe um candidato de uma
 * lista de BOTÕES (a11y nativa). A ESCOLHA ATUAL persistida (`recipeOfWeekConfig.recipeId`) é
 * carregada do `GET /api/admin/config` e, quando presente, seu TÍTULO é resolvido num 2º fetch
 * (`?id=`) — a config guarda só o id.
 *
 * ADR-0010: consome os ROUTE HANDLERS via `fetch` (NÃO Server Action). PUT envia SÓ o eixo
 * `recipeOfWeek` (upsert parcial preserva os demais eixos). `recipeId: null` (botão "Remover
 * escolha") volta a home pro fallback automático de Popularidade.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const SEARCH_DEBOUNCE_MS = 300

type Hit = { recipeId: string; titulo: string; slug: string | null }

export function RecipeOfWeekConfigSection() {
  const { messages, locale } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [current, setCurrent] = useState<Hit | null>(null) // escolha PERSISTIDA (título resolvido)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [pending, setPending] = useState<Hit | null>(null) // candidato escolhido, AINDA não salvo

  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorKey, setErrorKey] = useState<'erroReceita' | 'erroGenerico' | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/config')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { recipeOfWeek: { recipeId: string | null } }
      const recipeId = body.recipeOfWeek.recipeId
      if (recipeId === null) {
        setCurrent(null)
        return
      }
      const lookup = await fetch(
        `/api/admin/catalog/highlight-search?id=${encodeURIComponent(recipeId)}&locale=${encodeURIComponent(locale)}`,
      )
      const lookupBody = lookup.ok
        ? ((await lookup.json().catch(() => null)) as { hit: Hit | null } | null)
        : null
      // `hit: null` = a escolha salva não é (mais) catálogo aprovado — mostra "Nenhuma" (a home já
      // degrada pro fallback sozinha; aqui só refletimos o estado, sem forçar uma limpeza automática).
      setCurrent(lookupBody?.hit ?? null)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- roda 1x na montagem (mesmo padrão das outras seções)
  }, [])

  // Busca com debounce de timers reais (espelha `roles-section.tsx`). `reqId` descarta respostas
  // obsoletas; setState todo DENTRO do callback do timer (evita cascata em efeito).
  const reqId = useRef(0)
  useEffect(() => {
    const q = query.trim()
    if (pending || q.length === 0) return
    const id = ++reqId.current
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `/api/admin/catalog/highlight-search?q=${encodeURIComponent(q)}&locale=${encodeURIComponent(locale)}`,
        )
        const body = res.ok
          ? ((await res.json().catch(() => null)) as { hits?: Hit[] } | null)
          : null
        if (id !== reqId.current) return
        setResults(body?.hits ?? [])
      } catch {
        if (id === reqId.current) setResults([])
      } finally {
        if (id === reqId.current) setSearching(false)
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, pending, locale])

  function onQueryChange(value: string) {
    setQuery(value)
    reqId.current += 1
    setResults([])
    setSearching(value.trim().length > 0)
  }
  function pick(hit: Hit) {
    reqId.current += 1
    setPending(hit)
    setResults([])
    setSearching(false)
    setStatus('idle')
    setErrorKey(null)
  }
  function cancelPending() {
    reqId.current += 1
    setPending(null)
    setQuery('')
    setResults([])
    setSearching(false)
    setStatus('idle')
    setErrorKey(null)
  }

  async function save(recipeId: string | null): Promise<void> {
    if (saving || clearing) return
    if (recipeId === null) setClearing(true)
    else setSaving(true)
    setStatus('idle')
    setErrorKey(null)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeOfWeek: { recipeId } }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(body?.error === 'receita_invalida' ? 'erroReceita' : 'erroGenerico')
        setStatus('error')
        return
      }
      setCurrent(pending && recipeId === pending.recipeId ? pending : null)
      setPending(null)
      setQuery('')
      setResults([])
      setStatus('saved')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
      setClearing(false)
    }
  }

  return (
    <section aria-labelledby="receita-semana-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="receita-semana-titulo" className="font-display text-lg font-semibold text-fg">
          {m.receitaSemanaTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.receitaSemanaDescricao}</p>
      </div>

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-4">
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
        ) : (
          <>
            {/* Escolha ATUAL persistida — sempre visível, com o botão de limpar quando há uma. */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium tracking-wide text-muted uppercase">
                {m.receitaSemanaAtualLabel}
              </span>
              {current ? (
                <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {current.titulo}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void save(null)}
                    disabled={clearing}
                    aria-busy={clearing}
                    className="ml-auto shrink-0"
                  >
                    {clearing ? m.receitaSemanaLimpando : m.receitaSemanaLimpar}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">{m.receitaSemanaAtualVazio}</p>
              )}
            </div>

            {/* Busca + escolha de uma NOVA receita do catálogo aprovado. */}
            {!pending ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-fg">
                  {m.receitaSemanaBuscaLabel}
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder={m.receitaSemanaBuscaPlaceholder}
                    autoComplete="off"
                  />
                </label>
                <div aria-live="polite" className="min-h-5 text-sm text-muted">
                  {searching
                    ? m.receitaSemanaBuscaCarregando
                    : results.length > 0
                      ? m.receitaSemanaBuscaContagem.replace('{n}', String(results.length))
                      : query.trim().length > 0
                        ? m.receitaSemanaBuscaVazio
                        : null}
                </div>
                {results.length > 0 && (
                  <ul aria-label={m.receitaSemanaBuscaResultados} className="flex flex-col gap-1">
                    {results.map((hit) => (
                      <li key={hit.recipeId}>
                        <button
                          type="button"
                          onClick={() => pick(hit)}
                          className="flex w-full items-center gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:border-brand-ink hover:bg-brand/10"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-fg">{hit.titulo}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  {m.receitaSemanaSelecionada}
                </p>
                <div
                  aria-label={`${m.receitaSemanaSelecionada}: ${pending.titulo}`}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {pending.titulo}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={cancelPending}
                    className="ml-auto shrink-0"
                  >
                    {m.receitaSemanaTrocar}
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void save(pending.recipeId)}
                  disabled={saving}
                  aria-busy={saving}
                  className="self-start"
                >
                  {saving ? m.salvando : m.salvar}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {status === 'saved' && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {m.receitaSemanaSalvo}
        </p>
      )}
      {status === 'error' && errorKey && (
        <p role="alert" className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg">
          {errorKey === 'erroReceita' ? m.receitaSemanaErroReceita : m.erroGenerico}
        </p>
      )}
    </section>
  )
}
