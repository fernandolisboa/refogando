'use client'

/**
 * Config da DESCOBERTA na web (#164, ADR-0019) — Admin-only (a page `/admin/ai` revalida `min='admin'`
 * server-side; a API `/api/admin/config` reforça `requireRole 'admin'`). Liga/desliga a busca na web e
 * edita a ALLOWLIST de domínios (fonte ÚNICA tanto do endpoint `/api/discovery/web` quanto do guard de
 * SSRF do import). O provedor concreto/credencial é GATE HUMANO de deploy — esta UI só prepara a config.
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` via `fetch` (NÃO Server Action). O
 * servidor é a verdade — a validação/canonicalização da allowlist vive lá; aqui só ofertamos os campos
 * e renderizamos o que a rota devolve. PUT envia SÓ o eixo `webSearch` (os outros eixos da /admin/ai —
 * imagem + teto de receita — são da `AiConfigSection`, atualizáveis em separado pelo upsert parcial).
 *
 * Allowlist: textarea com UM domínio por linha. Validação cliente é LEVE (split por linha, descarta
 * vazias); o servidor revalida/canonicaliza (config_invalida → `webErroConfig`). Cores: só tokens
 * AA-verificados (#54); sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

/** textarea (uma linha por domínio) → string[] (descarta linhas vazias/espaços). */
function textToAllowlist(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
}

/** string[] → textarea (uma linha por domínio). */
function allowlistToText(allowlist: string[]): string {
  return allowlist.join('\n')
}

export function WebSearchConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [enabled, setEnabled] = useState(false)
  const [allowlistText, setAllowlistText] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorKey, setErrorKey] = useState<'erroConfig' | 'erroGenerico' | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/config')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { webSearch: { enabled: boolean; allowlist: string[] } }
      setEnabled(body.webSearch.enabled)
      setAllowlistText(allowlistToText(body.webSearch.allowlist))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carrega uma vez na montagem (timer p/ não cascatear setState — mesmo padrão de ai-config-section).
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function handleSave() {
    if (saving) return
    setStatus('idle')
    setErrorKey(null)
    setSaving(true)
    try {
      // Envia SÓ o eixo webSearch; o servidor canonicaliza/valida a allowlist (config_invalida → erro).
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          webSearch: { enabled, allowlist: textToAllowlist(allowlistText) },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(body?.error === 'config_invalida' ? 'erroConfig' : 'erroGenerico')
        setStatus('error')
        return
      }
      const body = (await res.json()) as { webSearch: { enabled: boolean; allowlist: string[] } }
      setEnabled(body.webSearch.enabled)
      setAllowlistText(allowlistToText(body.webSearch.allowlist))
      setStatus('saved')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="web-search-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="web-search-titulo" className="font-display text-lg font-semibold text-fg">
          {m.webTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.webDescricao}</p>
      </div>

      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-4">
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
        ) : (
          <>
            {/* Liga/desliga */}
            <label className="flex items-center gap-2 text-sm font-medium text-fg">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setEnabled(e.target.checked)
                  setStatus('idle')
                }}
                className="size-4 rounded border-border"
              />
              {m.webHabilitadaLabel}
            </label>

            {/* Allowlist: um domínio por linha. `htmlFor`/`id` (não label-wrap) p/ o nome acessível da
                textarea ser SÓ o rótulo, sem absorver o texto de ajuda (`aria-describedby` o associa). */}
            <div className="flex max-w-md flex-col gap-1">
              <label
                htmlFor="web-search-allowlist"
                className="text-sm font-medium text-fg"
              >
                {m.webAllowlistLabel}
              </label>
              <textarea
                id="web-search-allowlist"
                aria-describedby="web-search-allowlist-ajuda"
                value={allowlistText}
                onChange={(e) => {
                  setAllowlistText(e.target.value)
                  setStatus('idle')
                }}
                rows={5}
                spellCheck={false}
                className="rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span id="web-search-allowlist-ajuda" className="text-xs text-muted">
                {m.webAllowlistAjuda}
              </span>
            </div>

            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className="self-start"
            >
              {saving ? m.salvando : m.salvar}
            </Button>
          </>
        )}
      </div>

      {status === 'saved' && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {m.salvo}
        </p>
      )}
      {status === 'error' && errorKey && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {errorKey === 'erroConfig' ? m.webErroConfig : m.erroGenerico}
        </p>
      )}
    </section>
  )
}
