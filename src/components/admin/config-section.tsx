'use client'

/**
 * Modelos de IA de texto POR TAREFA (#63, ADR-0033/0034) — Admin-only (o `AdminConsole` só a monta
 * para `role==='admin'`; o servidor reforça com requireRole 'admin').
 *
 * Três blocos independentes (Geração, Tradução, Extração), cada um com modelo, esforço e thinking e o
 * próprio botão de salvar. O ajuste é guardado POR MODELO: trocar o modelo no select preenche o ajuste
 * salvo para ele (ou o default da tarefa). As opções de esforço/thinking seguem as capacidades que a
 * Models API informa para o modelo; o que ela não informa (ex.: se o thinking DESLIGA) o servidor
 * confirma com uma chamada de teste ao salvar, e a recusa volta com o motivo da Anthropic.
 *
 * ADR-0010: consome os ROUTE HANDLERS `GET/PUT /api/admin/config` e `GET /api/admin/models` via
 * `fetch` (NÃO Server Action). O servidor é a verdade: a lista vem de `/api/admin/models` e o PUT
 * revalida tudo. Modelo em uso fora da lista aparece marcado para o select não mentir.
 *
 * Mapeamento de erro por CHAVE do corpo `{error}` (NUNCA por status); QUALQUER outra resposta não-ok
 * (inclui 500 `erro_interno`/rede) → `erroGenerico`. Cores: só tokens AA-verificados da #54.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { fieldClassName } from '@/components/button'
import type { ModelOption } from '@/domain/claude-models'
import {
  AI_TASKS,
  EFFORT_LEVELS,
  TASK_DEFAULT_SETTINGS,
  activeSettings,
  type AiTask,
  type AiTaskState,
  type AiTasksConfig,
  type EffortLevel,
  type ModelSettings,
  type ThinkingMode,
} from '@/domain/ai-task-config'

type ErrorKey = 'erroModelo' | 'erroConfig' | 'erroAjusteNaoSuportado' | 'erroAjusteRecusado' | 'erroGenerico'

const TASK_COPY = {
  generation: { titulo: 'tarefaGeracaoTitulo', descricao: 'tarefaGeracaoDescricao' },
  translation: { titulo: 'tarefaTraducaoTitulo', descricao: 'tarefaTraducaoDescricao' },
  extraction: { titulo: 'tarefaExtracaoTitulo', descricao: 'tarefaExtracaoDescricao' },
} as const satisfies Record<AiTask, { titulo: string; descricao: string }>

const EFFORT_LABEL = {
  low: 'esforcoLow',
  medium: 'esforcoMedium',
  high: 'esforcoHigh',
  xhigh: 'esforcoXhigh',
  max: 'esforcoMax',
} as const satisfies Record<EffortLevel, string>

const ERROR_KEYS: Record<string, ErrorKey> = {
  modelo_invalido: 'erroModelo',
  config_invalida: 'erroConfig',
  ajuste_nao_suportado: 'erroAjusteNaoSuportado',
  ajuste_recusado: 'erroAjusteRecusado',
}

export function ConfigSection() {
  const { messages } = useLocale()
  const m = messages.admin
  const sys = messages.system

  const [tasks, setTasks] = useState<AiTasksConfig | null>(null)
  const [options, setOptions] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function load() {
    setLoading(true)
    setLoadError(false)
    try {
      const [res, modelsRes] = await Promise.all([fetch('/api/admin/config'), fetch('/api/admin/models')])
      if (!res.ok || !modelsRes.ok) {
        setLoadError(true)
        return
      }
      const body = (await res.json()) as { aiTasks: AiTasksConfig }
      const modelsBody = (await modelsRes.json()) as { models: ModelOption[] }
      setTasks(body.aiTasks)
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

  return (
    <section aria-labelledby="config-titulo" className="flex flex-col gap-3">
      <h2 id="config-titulo" className="font-display text-lg font-semibold text-fg">
        {m.configTitulo}
      </h2>
      <p className="text-sm text-muted">{m.configDescricao}</p>

      {/* Região persistente: `aria-live="polite"` + `aria-busy` anunciam o fim do loading e o que
          chegou (conteúdo ou erro). O wrapper NÃO é desmontado entre estados — só o conteúdo troca. */}
      <div aria-live="polite" aria-busy={loading} className="flex flex-col gap-6">
        {loading ? (
          <p className="text-sm text-muted">{sys.loading}</p>
        ) : loadError || !tasks ? (
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
          AI_TASKS.map((task) => (
            <TaskBlock
              key={task}
              task={task}
              state={tasks[task]}
              options={options}
              onSaved={(next) => setTasks(next)}
            />
          ))
        )}
      </div>
    </section>
  )
}

function TaskBlock({
  task,
  state,
  options,
  onSaved,
}: {
  task: AiTask
  state: AiTaskState
  options: ModelOption[]
  onSaved: (next: AiTasksConfig) => void
}) {
  const { messages } = useLocale()
  const m = messages.admin
  const copy = TASK_COPY[task]

  const [model, setModel] = useState(state.model)
  const [settings, setSettings] = useState<ModelSettings>(() => activeSettings(task, state))
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<{ key: ErrorKey; detail?: string } | null>(null)

  const caps = options.find((opt) => opt.id === model)?.capabilities ?? null
  // Sem capacidades conhecidas (modelo fora da lista ou API sem o bloco) ⇒ oferece tudo; a chamada de
  // teste no servidor decide. O valor atual sempre fica na lista (o select não mente).
  const effortChoices = EFFORT_LEVELS.filter(
    (level) => !caps || caps.effort.includes(level) || settings.effort === level,
  )
  const adaptiveOffered = !caps || caps.adaptiveThinking || settings.thinking === 'adaptive'

  function reset() {
    setStatus('idle')
    setError(null)
  }

  function changeModel(next: string) {
    setModel(next)
    // O ajuste é por modelo: recupera o salvo para ele, senão o default da tarefa.
    setSettings(state.byModel[next] ?? TASK_DEFAULT_SETTINGS[task])
    reset()
  }

  async function handleSave() {
    if (saving) return
    setSaving(true)
    reset()
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aiTasks: { [task]: { model, settings } } }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
        const key = (body?.error && ERROR_KEYS[body.error]) || 'erroGenerico'
        setError({ key, detail: key === 'erroAjusteRecusado' ? body?.message : undefined })
        setStatus('error')
        return
      }
      const body = (await res.json()) as { aiTasks: AiTasksConfig }
      onSaved(body.aiTasks)
      setStatus('saved')
    } catch {
      setError({ key: 'erroGenerico' })
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  const headingId = `ia-tarefa-${task}`
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-base font-semibold text-fg">
          {m[copy.titulo]}
        </h3>
        <p className="text-sm text-muted">{m[copy.descricao]}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-sm font-medium text-fg">
          {m.modeloLabel}
          <select value={model} onChange={(e) => changeModel(e.target.value)} className={fieldClassName}>
            {!options.some((opt) => opt.id === model) && (
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

        <label className="flex flex-col gap-1 text-sm font-medium text-fg">
          {m.esforcoLabel}
          <select
            value={settings.effort ?? ''}
            onChange={(e) => {
              setSettings({ ...settings, effort: (e.target.value || null) as EffortLevel | null })
              reset()
            }}
            className={fieldClassName}
          >
            <option value="">{m.padraoDoModelo}</option>
            {effortChoices.map((level) => (
              <option key={level} value={level}>
                {m[EFFORT_LABEL[level]]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium text-fg">
          {m.thinkingLabel}
          <select
            value={settings.thinking}
            onChange={(e) => {
              setSettings({ ...settings, thinking: e.target.value as ThinkingMode })
              reset()
            }}
            className={fieldClassName}
          >
            <option value="default">{m.padraoDoModelo}</option>
            {adaptiveOffered && <option value="adaptive">{m.thinkingAdaptativo}</option>}
            <option value="off">{m.thinkingDesligado}</option>
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

      {status === 'saved' && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-brand-ink">
          {m.salvo}
        </p>
      )}
      {status === 'error' && error && (
        <p
          role="alert"
          className="rounded-md border border-border bg-bg px-3 py-2 text-sm font-medium text-fg"
        >
          {m[error.key]}
          {error.detail ? ` ${error.detail}` : ''}
        </p>
      )}
    </div>
  )
}
