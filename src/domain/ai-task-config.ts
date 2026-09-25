/**
 * Config de IA POR TAREFA (ADR-0034) — PURO: tipos, defaults, validação e resolução. Sem I/O.
 *
 * Três tarefas de texto usam a Anthropic, cada uma com modelo e ajustes próprios, editáveis no admin:
 *  - `generation`  — Geração de Receita (o modelo mora na coluna `app_config.default_model`, legado #5);
 *  - `translation` — tradução por LLM (ADR-0030);
 *  - `extraction`  — Extração de ingredientes (#112).
 *
 * Ajustes (`ModelSettings`) são guardados POR MODELO dentro da tarefa: trocar de modelo e voltar
 * recupera o ajuste anterior. `effort: null` e `thinking: 'default'` = não manda o parâmetro (cada
 * modelo usa o próprio default). O que cada modelo aceita vem das capacidades da Models API; o que ela
 * não informa (ex.: se o thinking pode ser DESLIGADO) é verificado por uma chamada de teste ao salvar.
 */

export const AI_TASKS = ['generation', 'translation', 'extraction'] as const
export type AiTask = (typeof AI_TASKS)[number]

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/** `default` = omite o parâmetro; `adaptive` = `{type:'adaptive'}`; `off` = `{type:'disabled'}`. */
export const THINKING_MODES = ['default', 'adaptive', 'off'] as const
export type ThinkingMode = (typeof THINKING_MODES)[number]

export type ModelSettings = {
  effort: EffortLevel | null
  thinking: ThinkingMode
}

/** Estado resolvido de uma tarefa: modelo em uso + ajustes salvos por modelo. */
export type AiTaskState = {
  model: string
  byModel: Record<string, ModelSettings>
}

export type AiTasksConfig = Record<AiTask, AiTaskState>

/** Forma persistida (jsonb `app_config.ai_tasks`): tudo opcional; o que falta cai nos defaults. */
export type StoredAiTasks = Partial<Record<AiTask, { model?: string; byModel?: Record<string, ModelSettings> }>>

/**
 * Ajustes default por tarefa, usados quando o modelo em uso ainda não tem ajuste salvo. Seguros para
 * o modelo default de cada tarefa (a chamada de teste cobre qualquer outro modelo no momento de salvar).
 *  - Geração: esforço medium (as rotas têm teto de 60s); thinking no default do modelo.
 *  - Tradução/Extração: thinking DESLIGADO (ADR-0030 dec.1: tarefa fiel, sem raciocínio; com thinking,
 *    os tokens dele dividem o teto com o JSON e a saída trunca); esforço no default do modelo.
 */
export const TASK_DEFAULT_SETTINGS: Record<AiTask, ModelSettings> = {
  generation: { effort: 'medium', thinking: 'default' },
  translation: { effort: null, thinking: 'off' },
  extraction: { effort: null, thinking: 'off' },
}

const MAX_MODEL_ID = 100
const MAX_SETTINGS_PER_TASK = 50

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

export function isModelId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_MODEL_ID && /^[a-z0-9.@:_-]+$/i.test(v)
}

/** Valida um `ModelSettings` vindo do cliente ou do jsonb. Inválido ⇒ `null`. */
export function parseModelSettings(raw: unknown): ModelSettings | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as { effort?: unknown; thinking?: unknown }
  const effort = r.effort === null || r.effort === undefined ? null : r.effort
  if (effort !== null && !isOneOf(EFFORT_LEVELS, effort)) return null
  if (!isOneOf(THINKING_MODES, r.thinking)) return null
  return { effort, thinking: r.thinking }
}

/**
 * Re-valida o jsonb persistido (linha legada/editada à mão). Entrada ruim é DESCARTADA por item, nunca
 * lança: tarefa desconhecida, modelo inválido ou ajuste inválido somem e a leitura cai nos defaults.
 */
export function parseStoredAiTasks(raw: unknown): StoredAiTasks {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: StoredAiTasks = {}
  for (const task of AI_TASKS) {
    const t = (raw as Record<string, unknown>)[task]
    if (typeof t !== 'object' || t === null) continue
    const { model, byModel } = t as { model?: unknown; byModel?: unknown }
    const entry: { model?: string; byModel?: Record<string, ModelSettings> } = {}
    if (isModelId(model)) entry.model = model
    if (typeof byModel === 'object' && byModel !== null) {
      const settings: Record<string, ModelSettings> = {}
      for (const [id, s] of Object.entries(byModel).slice(0, MAX_SETTINGS_PER_TASK)) {
        const parsed = parseModelSettings(s)
        if (isModelId(id) && parsed) settings[id] = parsed
      }
      entry.byModel = settings
    }
    out[task] = entry
  }
  return out
}

/**
 * Resolve as três tarefas. `models` = modelo em uso por tarefa vindo de fora do jsonb (Geração: a
 * coluna `default_model`; Tradução/Extração: env var ou default em código) — o jsonb vence para
 * Tradução/Extração quando tem `model`.
 */
export function resolveAiTasks(stored: StoredAiTasks, models: Record<AiTask, string>): AiTasksConfig {
  const resolve = (task: AiTask): AiTaskState => ({
    model: task === 'generation' ? models.generation : (stored[task]?.model ?? models[task]),
    byModel: stored[task]?.byModel ?? {},
  })
  return { generation: resolve('generation'), translation: resolve('translation'), extraction: resolve('extraction') }
}

/** Ajuste efetivo do modelo em uso da tarefa: o salvo para ele, senão o default da tarefa. */
export function activeSettings(task: AiTask, state: AiTaskState): ModelSettings {
  return state.byModel[state.model] ?? TASK_DEFAULT_SETTINGS[task]
}

/** Grava o modelo + ajuste de uma tarefa no jsonb (imutável). Mantém os ajustes dos outros modelos. */
export function withTaskSettings(
  stored: StoredAiTasks,
  task: AiTask,
  model: string,
  settings: ModelSettings,
): StoredAiTasks {
  const current = stored[task] ?? {}
  // Tira e re-insere: o modelo salvo agora vira o mais recente na ordem de inserção.
  const others = Object.entries(current.byModel ?? {}).filter(([id]) => id !== model)
  const byModel = Object.fromEntries([...others, [model, settings]])
  // Teto de entradas: descarta as salvas há mais tempo — o jsonb não cresce sem limite.
  const trimmed = Object.fromEntries(Object.entries(byModel).slice(-MAX_SETTINGS_PER_TASK))
  return {
    ...stored,
    // Geração: o modelo mora na coluna `default_model`, não no jsonb.
    [task]: task === 'generation' ? { byModel: trimmed } : { model, byModel: trimmed },
  }
}

/** Parâmetros de request que um `ModelSettings` vira. `default`/`null` ⇒ o parâmetro não vai. */
export function tuningParams(settings: ModelSettings): {
  thinking?: { type: 'adaptive' } | { type: 'disabled' }
  effort?: EffortLevel
} {
  return {
    ...(settings.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(settings.thinking === 'off' ? { thinking: { type: 'disabled' as const } } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  }
}

// Folga de tokens quando o thinking pode estar ligado (`default` ou `adaptive`): os tokens de raciocínio
// dividem o `max_tokens` com a saída. Com `off`, o teto base da tarefa basta.
const THINKING_HEADROOM_TOKENS = 8_000

/** `max_tokens` da chamada: o teto base da tarefa, com folga se o thinking não estiver desligado. */
export function maxTokensFor(base: number, settings: ModelSettings): number {
  return settings.thinking === 'off' ? base : base + THINKING_HEADROOM_TOKENS
}

/**
 * Ajuste de UM modelo numa tarefa direto do jsonb cru (as rotas de Geração já leem a linha inteira de
 * `app_config`): o salvo para o modelo, senão o default da tarefa.
 */
export function settingsForModel(task: AiTask, rawAiTasks: unknown, model: string): ModelSettings {
  return parseStoredAiTasks(rawAiTasks)[task]?.byModel?.[model] ?? TASK_DEFAULT_SETTINGS[task]
}
