'use client'

/**
 * Config do AVISO de catálogo AI-assistido (#237, SEO #187) — Admin-only. Desde #268 vive na page
 * `/admin/catalog` (Curadoria, `min='curador'`), perto do Catálogo, mas renderizada SÓ pra admin
 * (`isAdmin && <…>` na page) — a garantia admin-only vem desse render condicional + da API
 * `/api/admin/config` que reforça `requireRole 'admin'` (a page NÃO é mais `min='admin'`). Liga/desliga o
 * aviso editorial OPCIONAL ("em colaboração entre curadoria e IA") e edita o seu TEXTO. CORTESIA: o
 * aviso aparece SÓ em receitas de catálogo quando ligado e NUNCA substitui os selos obrigatórios de
 * proveniência (`origin=ai_*` / imagem `ai_generated`).
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` via `fetch` (NÃO Server Action). O
 * servidor é a verdade — a validação do texto (não-vazio, teto) vive lá; aqui só ofertamos os campos e
 * renderizamos o que a rota devolve. PUT envia SÓ o eixo `catalogDisclosure` (os outros eixos da
 * /admin/ai são de outras seções, atualizáveis em separado pelo upsert parcial). Espelha
 * `web-search-config-section.tsx`. Cores: só tokens AA-verificados (#54); sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'

export function CatalogDisclosureConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [enabled, setEnabled] = useState(false)
  const [text, setText] = useState('')
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
      const body = (await res.json()) as { catalogDisclosure: { enabled: boolean; text: string } }
      setEnabled(body.catalogDisclosure.enabled)
      setText(body.catalogDisclosure.text)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carrega uma vez na montagem (timer p/ não cascatear setState — mesmo padrão das outras seções).
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function handleSave() {
    if (saving) return
    setStatus('idle')
    setErrorKey(null)
    setSaving(true)
    try {
      // Envia SÓ o eixo catalogDisclosure; o servidor valida o texto (não-vazio → config_invalida).
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ catalogDisclosure: { enabled, text } }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(body?.error === 'config_invalida' ? 'erroConfig' : 'erroGenerico')
        setStatus('error')
        return
      }
      const body = (await res.json()) as { catalogDisclosure: { enabled: boolean; text: string } }
      setEnabled(body.catalogDisclosure.enabled)
      setText(body.catalogDisclosure.text)
      setStatus('saved')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="catalog-disclosure-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="catalog-disclosure-titulo"
          className="font-display text-lg font-semibold text-fg"
        >
          {m.catalogoAvisoTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.catalogoAvisoDescricao}</p>
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
              {m.catalogoAvisoHabilitadoLabel}
            </label>

            {/* Texto editável. `htmlFor`/`id` (não label-wrap) p/ o nome acessível ser SÓ o rótulo;
                `aria-describedby` associa o texto de ajuda sem absorvê-lo no nome acessível. */}
            <div className="flex max-w-md flex-col gap-1">
              <label htmlFor="catalog-disclosure-texto" className="text-sm font-medium text-fg">
                {m.catalogoAvisoTextoLabel}
              </label>
              <textarea
                id="catalog-disclosure-texto"
                aria-describedby="catalog-disclosure-texto-ajuda"
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setStatus('idle')
                }}
                rows={3}
                className="rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span id="catalog-disclosure-texto-ajuda" className="text-xs text-muted">
                {m.catalogoAvisoTextoAjuda}
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
          {errorKey === 'erroConfig' ? m.catalogoAvisoErroConfig : m.erroGenerico}
        </p>
      )}
    </section>
  )
}
