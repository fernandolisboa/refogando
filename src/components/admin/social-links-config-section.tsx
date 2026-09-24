'use client'

/**
 * Links de redes sociais do rodapé (#451) — Admin-only. Vive na page `/admin/site` (Governança,
 * `min='admin'`). Editor de LISTA: cada linha é `{ plataforma, url, rótulo?, ligado }`; a ordem das
 * linhas = ordem de render no rodapé. Vazio = rodapé sem links.
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` via `fetch` (NÃO Server Action). O
 * servidor é a verdade — a validação (allowlist de plataforma, URL http(s) segura, sem duplicata) vive
 * no `parseSocialLinksConfig`; aqui só ofertamos os campos e mostramos o erro. PUT envia SÓ o eixo
 * `socialLinks` (upsert parcial preserva os demais eixos). Espelha `catalog-disclosure-config-section`.
 * Cores: só tokens AA-verificados (#54).
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import {
  SOCIAL_PLATFORMS,
  SOCIAL_LINKS_MAX,
  PLATFORM_DISPLAY,
  type SocialLink,
  type SocialPlatform,
} from '@/domain/social-links-config'

// Forma EDITÁVEL (rótulo sempre string p/ o input controlado; '' vira omitido na persistência).
type Row = { platform: SocialPlatform; url: string; label: string; enabled: boolean }

function toRows(links: SocialLink[]): Row[] {
  return links.map((l) => ({
    platform: l.platform,
    url: l.url,
    label: l.label ?? '',
    enabled: l.enabled,
  }))
}

/** Primeira plataforma ainda não usada (p/ o default da linha nova). Todas usadas ⇒ null. */
function firstUnused(rows: Row[]): SocialPlatform | null {
  const used = new Set(rows.map((r) => r.platform))
  return SOCIAL_PLATFORMS.find((p) => !used.has(p)) ?? null
}

export function SocialLinksConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/config')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { socialLinks: SocialLink[] }
      setRows(toRows(body.socialLinks))
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

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
    setStatus('idle')
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i))
    setStatus('idle')
  }
  function add() {
    const platform = firstUnused(rows)
    if (platform === null) return
    setRows((prev) => [...prev, { platform, url: '', label: '', enabled: true }])
    setStatus('idle')
  }

  async function handleSave() {
    if (saving) return
    setStatus('idle')
    setSaving(true)
    try {
      // Envia SÓ o eixo socialLinks (label '' é aceito e vira omitido no servidor).
      const payload = rows.map((r) => ({
        platform: r.platform,
        url: r.url.trim(),
        label: r.label,
        enabled: r.enabled,
      }))
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ socialLinks: payload }),
      })
      if (!res.ok) {
        setStatus('error')
        return
      }
      const body = (await res.json()) as { socialLinks: SocialLink[] }
      setRows(toRows(body.socialLinks))
      setStatus('saved')
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const atMax = rows.length >= SOCIAL_LINKS_MAX || firstUnused(rows) === null

  return (
    <section aria-labelledby="social-links-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="social-links-titulo" className="font-display text-lg font-semibold text-fg">
          {m.redesTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.redesDescricao}</p>
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
            {rows.length === 0 ? (
              <p className="text-sm text-muted">{m.redesVazio}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rows.map((r, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end"
                  >
                    <div className="flex flex-col gap-1">
                      <label htmlFor={`social-plat-${i}`} className="text-xs font-medium text-muted">
                        {m.redesPlataformaLabel}
                      </label>
                      <select
                        id={`social-plat-${i}`}
                        value={r.platform}
                        onChange={(e) => update(i, { platform: e.target.value as SocialPlatform })}
                        className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {SOCIAL_PLATFORMS.map((p) => (
                          <option key={p} value={p}>
                            {PLATFORM_DISPLAY[p]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <label htmlFor={`social-url-${i}`} className="text-xs font-medium text-muted">
                        {m.redesUrlLabel}
                      </label>
                      <input
                        id={`social-url-${i}`}
                        type="url"
                        value={r.url}
                        onChange={(e) => update(i, { url: e.target.value })}
                        className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <label htmlFor={`social-label-${i}`} className="text-xs font-medium text-muted">
                        {m.redesRotuloLabel}
                      </label>
                      <input
                        id={`social-label-${i}`}
                        type="text"
                        value={r.label}
                        onChange={(e) => update(i, { label: e.target.value })}
                        className="rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-fg">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        onChange={(e) => update(i, { enabled: e.target.checked })}
                        className="size-4 rounded border-border"
                      />
                      {m.redesLigadoLabel}
                    </label>
                    <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)}>
                      {m.redesRemover}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={add} disabled={atMax}>
                {m.redesAdicionar}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={saving}
                aria-busy={saving}
              >
                {saving ? m.redesSalvando : m.redesSalvar}
              </Button>
            </div>
          </>
        )}
      </div>

      {status === 'saved' && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {m.redesSalvo}
        </p>
      )}
      {status === 'error' && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m.redesErro}
        </p>
      )}
    </section>
  )
}
