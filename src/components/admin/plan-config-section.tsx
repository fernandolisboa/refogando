'use client'

/**
 * Tabela `pro` dos tetos de cota (Fase 2 de billing, #466) — Admin-only (a page `/admin/plano`
 * revalida `min='admin'` server-side; a API `/api/admin/config` reforça `requireRole 'admin'`).
 * Edita os `proCaps` — as três dimensões de cota (geração de receita, imagem, extração) por papel,
 * SÓ para usuários `plan='pro'`.
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` via `fetch` (a validação
 * tudo-ou-nada mora no servidor — `parseProCaps`); aqui só ofertamos os valores e refletimos o que a
 * rota devolve. PUT envia SÓ o eixo `proCaps` (os demais eixos de config são preservados pelo upsert
 * parcial do route).
 *
 * FLAG-OFF: a chave é o interruptor "tabela pro ligada". DESLIGADO ⇒ PUT envia `proCaps: null` =
 * NENHUMA tabela pro ⇒ TODO mundo (inclusive `pro`) pega o teto FREE de hoje (byte-idêntico). LIGADO
 * ⇒ envia o bundle dos três eixos. Isto NÃO cobra nada: só habilita tetos maiores para quem já é
 * `pro` (concessão manual, à parte). Tetos: input numérico por papel; VAZIO = ilimitado (`null`).
 * Cores: só tokens AA-verificados (#54); sem âmbar/accent.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ROLES, type Role } from '@/domain/user'
import { type ProCaps } from '@/domain/pro-caps'

type CapsForm = Record<Role, string>
type Dimension = 'recipeGen' | 'imageGen' | 'extraction'

/** Sugestão inicial quando ainda não há tabela pro (o admin ajusta antes de ligar). */
const SUGGESTED: Record<Dimension, Record<Role, number | null>> = {
  recipeGen: { usuario: 30, curador: 60, admin: null },
  imageGen: { usuario: 15, curador: 30, admin: null },
  extraction: { usuario: 300, curador: 600, admin: null },
}

/** config → form: `null` (ilimitado) vira string vazia; número vira sua string. */
function capsToForm(caps: Record<Role, number | null>): CapsForm {
  const out = {} as CapsForm
  for (const role of ROLES) out[role] = caps[role] == null ? '' : String(caps[role])
  return out
}

/** form → caps: vazio = `null` (ilimitado); inteiro ≥ 0 = número; senão `null` (inválido → bloqueia). */
function formToCaps(form: CapsForm): Record<Role, number | null> | null {
  const out = {} as Record<Role, number | null>
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

export function PlanConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [proEnabled, setProEnabled] = useState(false)
  const [recipeGen, setRecipeGen] = useState<CapsForm>(() => capsToForm(SUGGESTED.recipeGen))
  const [imageGen, setImageGen] = useState<CapsForm>(() => capsToForm(SUGGESTED.imageGen))
  const [extraction, setExtraction] = useState<CapsForm>(() => capsToForm(SUGGESTED.extraction))
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

  // proCaps do GET → estado. `null` (sem tabela pro) ⇒ interruptor desligado + sugestão nos campos;
  // bundle ⇒ ligado + valores persistidos. Inline (setters estáveis + puras de módulo) p/ o effect de
  // montagem não acusar exhaustive-deps (espelha ai-config-section).
  function applyProCaps(proCaps: ProCaps | null) {
    if (proCaps === null) {
      setProEnabled(false)
      setRecipeGen(capsToForm(SUGGESTED.recipeGen))
      setImageGen(capsToForm(SUGGESTED.imageGen))
      setExtraction(capsToForm(SUGGESTED.extraction))
      return
    }
    setProEnabled(true)
    setRecipeGen(capsToForm(proCaps.recipeGen))
    setImageGen(capsToForm(proCaps.imageGen))
    setExtraction(capsToForm(proCaps.extraction))
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
      const body = (await res.json()) as { proCaps: ProCaps | null }
      // Inline (não via `applyProCaps`): assim `load` fecha SÓ sobre setters estáveis + as puras de
      // módulo (`capsToForm`/`SUGGESTED`) ⇒ o effect de montagem não acusa exhaustive-deps (espelha
      // ai-config-section). O retry (botão) redispara `load`; o save reusa `applyProCaps`.
      const proCaps = body.proCaps ?? null
      if (proCaps === null) {
        setProEnabled(false)
        setRecipeGen(capsToForm(SUGGESTED.recipeGen))
        setImageGen(capsToForm(SUGGESTED.imageGen))
        setExtraction(capsToForm(SUGGESTED.extraction))
      } else {
        setProEnabled(true)
        setRecipeGen(capsToForm(proCaps.recipeGen))
        setImageGen(capsToForm(proCaps.imageGen))
        setExtraction(capsToForm(proCaps.extraction))
      }
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

  async function handleSave() {
    if (saving) return
    setStatus('idle')
    setErrorKey(null)

    let proCaps: ProCaps | null
    if (!proEnabled) {
      // Desligado: LIMPA a tabela pro (byte-idêntico ao free) — não valida os campos.
      proCaps = null
    } else {
      const rg = formToCaps(recipeGen)
      const ig = formToCaps(imageGen)
      const ex = formToCaps(extraction)
      if (rg === null || ig === null || ex === null) {
        setErrorKey('erroConfig')
        setStatus('error')
        return
      }
      proCaps = { recipeGen: rg, imageGen: ig, extraction: ex }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ proCaps }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as { error?: string } | null
        setErrorKey(b?.error === 'config_invalida' ? 'erroConfig' : 'erroGenerico')
        setStatus('error')
        return
      }
      const b = (await res.json()) as { proCaps: ProCaps | null }
      applyProCaps(b.proCaps ?? null)
      setStatus('saved')
    } catch {
      setErrorKey('erroGenerico')
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const dimensions: { key: Dimension; legend: string; form: CapsForm; set: (f: CapsForm) => void }[] =
    [
      { key: 'recipeGen', legend: m.planoProReceitaLabel, form: recipeGen, set: setRecipeGen },
      { key: 'imageGen', legend: m.planoProImagemLabel, form: imageGen, set: setImageGen },
      { key: 'extraction', legend: m.planoProExtracaoLabel, form: extraction, set: setExtraction },
    ]

  return (
    <section aria-labelledby="plano-procaps-titulo" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="plano-procaps-titulo" className="font-display text-lg font-semibold text-fg">
          {m.planoProCapsTitulo}
        </h2>
        <p className="max-w-[60ch] text-sm text-muted">{m.planoProCapsDescricao}</p>
        {/* Aviso concierge: deixa EXPLÍCITO que isto não cobra nada (billing real não está ligado). */}
        <p className="max-w-[60ch] rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg">
          {m.planoConciergeAviso}
        </p>
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
            {/* Interruptor da tabela pro (flag-off por padrão). */}
            <label className="flex items-center gap-2 text-sm font-medium text-fg">
              <input
                type="checkbox"
                checked={proEnabled}
                onChange={(e) => {
                  setProEnabled(e.target.checked)
                  setStatus('idle')
                }}
                className="size-4 rounded border-border"
              />
              {m.planoProAtivarLabel}
            </label>
            <p className="max-w-[60ch] text-xs text-muted">{m.planoProAtivarAjuda}</p>

            {/* Os três eixos de teto PRO por papel. Desabilitados quando a tabela pro está desligada. */}
            {dimensions.map(({ key, legend, form, set }) => (
              <fieldset key={key} className="flex flex-col gap-2" disabled={!proEnabled}>
                <legend className="text-sm font-medium text-fg">{legend}</legend>
                <p className="text-xs text-muted">{m.aiTetoAjuda}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {ROLES.map((role) => (
                    <label
                      key={role}
                      className="flex flex-col gap-1 text-sm font-medium text-fg"
                    >
                      {roleLabel[role]}
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={form[role]}
                        placeholder={m.aiTetoIlimitado}
                        disabled={!proEnabled}
                        onChange={(e) => {
                          set({ ...form, [role]: e.target.value })
                          setStatus('idle')
                        }}
                        className="w-32"
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}

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
          {errorKey === 'erroConfig' ? m.planoErroConfig : m.erroGenerico}
        </p>
      )}
    </section>
  )
}
