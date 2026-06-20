'use client'

/**
 * Config da geração de imagem por IA (#134) — Admin-only (a page `/admin/ai` revalida `min='admin'`
 * server-side; a API `/api/admin/config` reforça `requireRole 'admin'`). Liga/desliga a geração,
 * escolhe o modelo e edita os tetos diários por papel.
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` via `fetch` (NÃO Server Action). O
 * servidor é a verdade — a allowlist de modelos e a validação dos tetos vivem lá; aqui só ofertamos
 * os valores e renderizamos o que a rota devolve. PUT envia SÓ o eixo `imageGen` (o `defaultModel` de
 * chat é a seção `/admin/config`, atualizável em separado).
 *
 * Tetos: input numérico por papel; VAZIO = ilimitado (`null` — JSON não tem Infinity). Validação
 * cliente leve (inteiro ≥ 0 ou vazio) evita mandar lixo; o servidor revalida (config_invalida →
 * `aiErroConfig`). Cores: só tokens AA-verificados (#54); sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { btnPrimarySm, fieldClassName } from '@/components/button'
import { ROLES, type Role } from '@/domain/user'
import {
  IMAGE_GEN_MODELS,
  DEFAULT_IMAGE_MODEL,
  type ImageGenConfig,
  type ImageGenCapByRole,
} from '@/domain/image-gen-config'

type CapsForm = Record<Role, string>

/** config → form: `null` (ilimitado) vira string vazia; número vira sua string. */
function capsToForm(caps: ImageGenCapByRole): CapsForm {
  const out = {} as CapsForm
  for (const role of ROLES) out[role] = caps[role] == null ? '' : String(caps[role])
  return out
}

/** form → caps: vazio = `null` (ilimitado); inteiro ≥ 0 = número; senão `null` (inválido). */
function formToCaps(form: CapsForm): ImageGenCapByRole | null {
  const out = {} as ImageGenCapByRole
  for (const role of ROLES) {
    const t = form[role].trim()
    if (t === '') {
      out[role] = null
      continue
    }
    const n = Number(t)
    if (!Number.isInteger(n) || n < 0) return null
    out[role] = n
  }
  return out
}

export function AiConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [enabled, setEnabled] = useState(true)
  const [model, setModel] = useState<string>(DEFAULT_IMAGE_MODEL)
  const [caps, setCaps] = useState<CapsForm>(() => capsToForm({ usuario: 3, curador: 5, admin: null }))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorKey, setErrorKey] = useState<'erroConfig' | 'erroGenerico' | null>(null)

  const roleLabel: Record<Role, string> = {
    usuario: m.papelUsuario,
    curador: m.papelCurador,
    admin: m.papelAdmin,
  }

  function applyConfig(cfg: ImageGenConfig) {
    setEnabled(cfg.enabled)
    setModel(cfg.model)
    setCaps(capsToForm(cfg.dailyCapByRole))
  }

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await fetch('/api/admin/config')
      if (!res.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { imageGen: ImageGenConfig }
      // Inline (não via `applyConfig`): assim `load` fecha SÓ sobre setters estáveis + a pura
      // `capsToForm` (módulo) ⇒ o effect de montagem não acusa exhaustive-deps (espelha config-section).
      setEnabled(body.imageGen.enabled)
      setModel(body.imageGen.model)
      setCaps(capsToForm(body.imageGen.dailyCapByRole))
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Carrega uma vez na montagem (timer p/ não cascatear setState na montagem — mesmo padrão de
    // config-section/search-experience). O botão de retry redispara `load`.
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [])

  async function handleSave() {
    if (saving) return
    setStatus('idle')
    setErrorKey(null)
    // Validação cliente leve: tetos inválidos ⇒ erro local, sem enviar (não vira `null` silencioso).
    const dailyCapByRole = formToCaps(caps)
    if (dailyCapByRole === null) {
      setErrorKey('erroConfig')
      setStatus('error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageGen: { enabled, model, dailyCapByRole } }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(body?.error === 'config_invalida' ? 'erroConfig' : 'erroGenerico')
        setStatus('error')
        return
      }
      const body = (await res.json()) as { imageGen: ImageGenConfig }
      applyConfig(body.imageGen)
      setStatus('saved')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="ai-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="ai-titulo" className="font-display text-lg font-semibold text-fg">
          {m.aiTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.aiDescricao}</p>
      </div>

      {/* Região persistente com aria-live/aria-busy (mesmo recorte de config-section). */}
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
            <button type="button" onClick={() => void load()} className={btnPrimarySm}>
              {sys.retry}
            </button>
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
              {m.aiHabilitadaLabel}
            </label>

            {/* Modelo */}
            <label className="flex max-w-xs flex-col gap-1 text-sm font-medium text-fg">
              {m.aiModeloLabel}
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value)
                  setStatus('idle')
                }}
                className={fieldClassName}
              >
                {IMAGE_GEN_MODELS.map((value) => (
                  <option key={value} value={value}>
                    {value === DEFAULT_IMAGE_MODEL ? m.aiModeloNanoBanana : value}
                  </option>
                ))}
              </select>
            </label>

            {/* Tetos por papel */}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-fg">{m.aiTetosLabel}</legend>
              <p className="text-xs text-muted">{m.aiTetoAjuda}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {ROLES.map((role) => (
                  <label key={role} className="flex flex-col gap-1 text-sm font-medium text-fg">
                    {roleLabel[role]}
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={caps[role]}
                      placeholder={m.aiTetoIlimitado}
                      onChange={(e) => {
                        setCaps((prev) => ({ ...prev, [role]: e.target.value }))
                        setStatus('idle')
                      }}
                      className={`${fieldClassName} w-32`}
                    />
                  </label>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className={`${btnPrimarySm} self-start disabled:opacity-70`}
            >
              {saving ? m.salvando : m.salvar}
            </button>
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
          {errorKey === 'erroConfig' ? m.aiErroConfig : m.erroGenerico}
        </p>
      )}
    </section>
  )
}
