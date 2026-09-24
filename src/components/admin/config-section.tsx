'use client'

/**
 * Configuração do modelo de geração padrão (#63, AC1) — Admin-only (o `AdminConsole` só a
 * monta para `role==='admin'`; o servidor reforça com requireRole 'admin').
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` e `GET /api/admin/models` via
 * `fetch` (NÃO Server Action). O servidor é a verdade: as opções vêm de `/api/admin/models` (o mais
 * novo de Opus/Sonnet/Fable segundo a Anthropic, com fallback pinado) e o PUT valida contra a mesma
 * lista. Se o modelo salvo não está mais na lista (ex.: saiu um Opus novo), ele aparece como opção
 * "fora da lista" para o select não mentir sobre o que está em uso.
 *
 * Mapeamento de erro por CHAVE do corpo `{error}` (NUNCA por status): `modelo_invalido` →
 * mensagem específica; QUALQUER outra resposta não-ok (inclui 500 `erro_interno`/rede) →
 * `erroGenerico`. Cores: só tokens AA-verificados da #54 (neutros + brand); sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { fieldClassName } from '@/components/button'
import type { ModelOption } from '@/domain/claude-models'

export function ConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [model, setModel] = useState<string | null>(null)
  const [options, setOptions] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorKey, setErrorKey] = useState<'erroModelo' | 'erroGenerico' | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const [res, modelsRes] = await Promise.all([
        fetch('/api/admin/config'),
        fetch('/api/admin/models'),
      ])
      if (!res.ok || !modelsRes.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { defaultModel: string }
      const modelsBody = (await modelsRes.json()) as { models: ModelOption[] }
      setModel(body.defaultModel)
      setOptions(modelsBody.models)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carrega uma vez na montagem; o botão de retry redispara `load`. O fetch roda num
    // timer (não no corpo síncrono do effect) para não disparar setState em cascata na
    // montagem — mesmo padrão de `search-experience.tsx`. O cleanup cancela se desmontar antes.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function handleSave() {
    if (saving || model == null) return
    setSaving(true)
    setStatus('idle')
    setErrorKey(null)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultModel: model }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        // Discrimina pela CHAVE do corpo; 500/rede/desconhecido → genérico.
        setErrorKey(body?.error === 'modelo_invalido' ? 'erroModelo' : 'erroGenerico')
        setStatus('error')
        return
      }
      const body = (await res.json()) as { defaultModel: string }
      setModel(body.defaultModel)
      setStatus('saved')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="config-titulo" className="flex flex-col gap-3">
      <h2 id="config-titulo" className="font-display text-lg font-semibold text-fg">
        {m.configTitulo}
      </h2>

      {/* Região persistente: `aria-live="polite"` + `aria-busy` anunciam, a um leitor de tela
          que permaneceu na seção, o fim do loading e o que chegou (conteúdo ou erro). O wrapper
          NÃO é desmontado entre estados — só seu conteúdo troca — então o anúncio dispara (o
          `aria-busy` no <p> efêmero do loading não anunciaria nada). Mesmo recorte de
          search-experience.tsx. */}
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
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-col gap-1 text-sm font-medium text-fg">
              {m.modeloLabel}
              <select
                value={model ?? ''}
                onChange={(e) => {
                  setModel(e.target.value)
                  setStatus('idle')
                }}
                className={fieldClassName}
              >
                {model != null && !options.some((opt) => opt.id === model) && (
                  <option value={model}>
                    {model} ({m.modeloForaDaLista})
                  </option>
                )}
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.displayName}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className="disabled:opacity-70"
            >
              {saving ? m.salvando : m.salvar}
            </Button>
          </div>
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
          {m[errorKey]}
        </p>
      )}
    </section>
  )
}
