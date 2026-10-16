/**
 * Config de IA POR TAREFA (ADR-0034) — PURO: tipos, defaults, validação e resolução. Sem I/O.
 *
 * Cinco tarefas de texto usam a Anthropic, cada uma com modelo e ajustes próprios, editáveis no admin:
 *  - `generation`  — Geração de Receita (o modelo mora na coluna `app_config.default_model`, legado #5);
 *  - `translation` — tradução por LLM (ADR-0030);
 *  - `extraction`  — Extração de ingredientes (#112);
 *  - `menu`        — Sugestão de cardápio (ADR-0036): escolhe Receitas existentes para a semana;
 *  - `imageScene`  — Cenário da imagem (ADR-0044): o diretor de arte escolhe a cena da foto do prato.
 *
 * Ajustes (`ModelSettings`) são guardados POR MODELO dentro da tarefa: trocar de modelo e voltar
 * recupera o ajuste anterior. `effort: null` e `thinking: 'default'` = não manda o parâmetro (cada
 * modelo usa o próprio default). O que cada modelo aceita vem das capacidades da Models API; o que ela
 * não informa (ex.: se o thinking pode ser DESLIGADO) é verificado por uma chamada de teste ao salvar.
 */

import { atLeastVersion, parseModelId } from '@/domain/model-id'

export const AI_TASKS = ['generation', 'translation', 'extraction', 'menu', 'imageScene'] as const
export type AiTask = (typeof AI_TASKS)[number]

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type EffortLevel = (typeof EFFORT_LEVELS)[number]

/**
 * `default` = omite o parâmetro; `adaptive` = `{type:'adaptive'}`; `off` = `{type:'disabled'}`;
 * `betweenTools` = `{type:'between_tools'}`, o nível MAIS BAIXO de thinking do Sonnet 5.5 (que recusa
 * `disabled`): sem raciocínio estendido, só notas curtas entre chamadas de ferramenta. Cada modelo aceita
 * um subconjunto (Opus 5.5 não desliga; só o Sonnet 5.5 aceita `between_tools`) — a chamada de teste
 * ao salvar decide.
 */
export const THINKING_MODES = ['default', 'adaptive', 'off', 'betweenTools'] as const
export type ThinkingMode = (typeof THINKING_MODES)[number]

export type ModelSettings = {
  effort: EffortLevel | null
  thinking: ThinkingMode
}

/**
 * Estado resolvido de uma tarefa: modelo em uso + ajustes salvos por modelo + se o modelo acompanha
 * sozinho a versão nova da família (checagem diária com chamada de teste; ligado por padrão).
 */
export type AiTaskState = {
  model: string
  byModel: Record<string, ModelSettings>
  auto: boolean
}

export type AiTasksConfig = Record<AiTask, AiTaskState>

/** Forma persistida (jsonb `app_config.ai_tasks`): tudo opcional; o que falta cai nos defaults. */
export type StoredAiTaskEntry = { model?: string; byModel?: Record<string, ModelSettings>; auto?: boolean }
export type StoredAiTasks = Partial<Record<AiTask, StoredAiTaskEntry>>

/**
 * Ajustes BASE por tarefa. O default efetivo de um modelo sem ajuste salvo é `defaultSettings`, que
 * troca o `off` destas bases pelo jeito que o modelo aceita (o Sonnet 5.5, default das tarefas, recusa
 * `disabled`). A chamada de teste cobre qualquer outro modelo no momento de salvar.
 *  - Geração: esforço medium (as rotas têm teto de 60s); thinking no default do modelo.
 *  - Tradução/Extração: thinking DESLIGADO (ADR-0030 dec.1: tarefa fiel, sem raciocínio; com thinking,
 *    os tokens dele dividem o teto com o JSON e a saída trunca); esforço no default do modelo.
 *  - Sugestão de cardápio (ADR-0036): esforço low (escolher de uma lista fechada é tarefa curta, e a
 *    chamada tem o prazo de 50s com ~150 Receitas no prompt); thinking no default do modelo (com folga
 *    no `max_tokens`).
 *  - Cenário da imagem (ADR-0044): esforço low e thinking DESLIGADO (classificação curta antes de cada
 *    imagem, com prazo de 8s). Cada modelo desliga do seu jeito: ver `defaultSettings`.
 */
export const TASK_DEFAULT_SETTINGS: Record<AiTask, ModelSettings> = {
  generation: { effort: 'medium', thinking: 'default' },
  translation: { effort: null, thinking: 'off' },
  extraction: { effort: null, thinking: 'off' },
  menu: { effort: 'low', thinking: 'default' },
  imageScene: { effort: 'low', thinking: 'off' },
}

/**
 * Como cada modelo "desliga" o thinking nos DEFAULTS das tarefas que pedem `off` (Tradução, Extração,
 * Cenário). Só vale para o default: o admin escolhe qualquer modo e a chamada de teste valida (e o cron
 * de versão grava o ajuste que a Anthropic aceitou). Por família + versão mínima, para a versão seguinte
 * já nascer com o default da anterior:
 *  - Sonnet ≥ 5.5: `disabled` dá 400; o mais baixo é `between_tools` (aceito com esforço ≤ high, que é
 *    o default dele e o `low` do Cenário).
 *  - Opus ≥ 5.5 e Fable: o thinking não desliga (400 com `disabled`); fica no default do modelo.
 *  - Haiku (5.5 aceita `disabled` com esforço ≤ high; o default dele é medium) e o resto: a base.
 */
function thinkingOffFor(model: string): ThinkingMode {
  if (atLeastVersion(model, 'sonnet', 5, 5)) return 'betweenTools'
  if (atLeastVersion(model, 'opus', 5, 5) || parseModelId(model)?.family === 'fable') return 'default'
  return 'off'
}

/** Ajuste default de uma tarefa PARA um modelo: o da tarefa, com o "desligado" no jeito que o modelo aceita. */
export function defaultSettings(task: AiTask, model: string): ModelSettings {
  const base = TASK_DEFAULT_SETTINGS[task]
  return base.thinking === 'off' ? { ...base, thinking: thinkingOffFor(model) } : base
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
    const { model, byModel, auto } = t as { model?: unknown; byModel?: unknown; auto?: unknown }
    const entry: StoredAiTaskEntry = {}
    if (isModelId(model)) entry.model = model
    if (typeof auto === 'boolean') entry.auto = auto
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
 * Resolve as tarefas. `models` = modelo em uso por tarefa vindo de fora do jsonb (Geração: a coluna
 * `default_model`; as demais: env var ou default em código) — o jsonb vence para as demais quando tem
 * `model`.
 */
export function resolveAiTasks(stored: StoredAiTasks, models: Record<AiTask, string>): AiTasksConfig {
  const resolve = (task: AiTask): AiTaskState => ({
    model: task === 'generation' ? models.generation : (stored[task]?.model ?? models[task]),
    byModel: stored[task]?.byModel ?? {},
    auto: stored[task]?.auto ?? true,
  })
  return Object.fromEntries(AI_TASKS.map((task) => [task, resolve(task)])) as AiTasksConfig
}

/** Ajuste efetivo do modelo em uso da tarefa: o salvo para ele, senão o default da tarefa p/ ele. */
export function activeSettings(task: AiTask, state: AiTaskState): ModelSettings {
  return state.byModel[state.model] ?? defaultSettings(task, state.model)
}

/**
 * Grava o modelo + ajuste de uma tarefa no jsonb (imutável). Mantém os ajustes dos outros modelos.
 * `auto` ausente ⇒ mantém o que já estava salvo.
 */
export function withTaskSettings(
  stored: StoredAiTasks,
  task: AiTask,
  model: string,
  settings: ModelSettings,
  auto?: boolean,
): StoredAiTasks {
  const current = stored[task] ?? {}
  // Tira e re-insere: o modelo salvo agora vira o mais recente na ordem de inserção.
  const others = Object.entries(current.byModel ?? {}).filter(([id]) => id !== model)
  const byModel = Object.fromEntries([...others, [model, settings]])
  // Teto de entradas: descarta as salvas há mais tempo — o jsonb não cresce sem limite.
  const trimmed = Object.fromEntries(Object.entries(byModel).slice(-MAX_SETTINGS_PER_TASK))
  const nextAuto = auto ?? current.auto
  return {
    ...stored,
    // Geração: o modelo mora na coluna `default_model`, não no jsonb.
    [task]: {
      ...(task === 'generation' ? {} : { model }),
      byModel: trimmed,
      ...(nextAuto === undefined ? {} : { auto: nextAuto }),
    },
  }
}

/**
 * Ajustes a TESTAR, em ordem, ao trocar sozinho a tarefa para a versão nova da família (checagem diária).
 * Modelo novo pode recusar o ajuste de hoje (ex.: Sonnet 5.5 recusa `thinking: disabled`), então a
 * escada tenta, nesta ordem, até a Anthropic aceitar um:
 *  1. o já salvo para o modelo novo (o admin escolheu antes);
 *  2. o ajuste em uso hoje, sem esforço que o modelo novo não oferece;
 *  3. se o thinking de hoje é "desligado" (`off`/`betweenTools`), os outros jeitos de desligar e, por
 *     último, o default do modelo (há modelos em que o thinking não desliga);
 *  4. o default da tarefa para o modelo novo.
 * Sem repetições. PURO: quem testa e grava é `server/claude/model-auto-upgrade.ts`.
 */
export function upgradeCandidates(
  task: AiTask,
  state: AiTaskState,
  next: { id: string; effort: EffortLevel[] | null },
): ModelSettings[] {
  const fitEffort = (s: ModelSettings): ModelSettings =>
    s.effort && next.effort && !next.effort.includes(s.effort) ? { ...s, effort: null } : s
  const current = fitEffort(activeSettings(task, state))
  const thinkingOff = current.thinking === 'off' || current.thinking === 'betweenTools'
  const ladder: ModelSettings[] = [
    ...(state.byModel[next.id] ? [state.byModel[next.id]] : []),
    current,
    ...(thinkingOff
      ? (['off', 'betweenTools', 'default'] as const).map((thinking) => ({ ...current, thinking }))
      : []),
    fitEffort(defaultSettings(task, next.id)),
  ]
  const seen = new Set<string>()
  return ladder.filter((s) => {
    const key = `${s.effort ?? ''}|${s.thinking}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Parâmetros de request que um `ModelSettings` vira. `default`/`null` ⇒ o parâmetro não vai. */
export function tuningParams(settings: ModelSettings): {
  thinking?: { type: 'adaptive' } | { type: 'disabled' } | { type: 'between_tools' }
  effort?: EffortLevel
} {
  return {
    ...(settings.thinking === 'adaptive' ? { thinking: { type: 'adaptive' as const } } : {}),
    ...(settings.thinking === 'off' ? { thinking: { type: 'disabled' as const } } : {}),
    ...(settings.thinking === 'betweenTools' ? { thinking: { type: 'between_tools' as const } } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
  }
}

// Folga de tokens quando o thinking pode estar ligado (`default` ou `adaptive`): os tokens de raciocínio
// dividem o `max_tokens` com a saída. Com `off`, o teto base da tarefa basta. `betweenTools` também
// ganha a folga: sem ferramentas não há o que pensar, mas é teto (não custo) e não vale arriscar truncar.
const THINKING_HEADROOM_TOKENS = 8_000

/** `max_tokens` da chamada: o teto base da tarefa, com folga se o thinking não estiver desligado. */
export function maxTokensFor(base: number, settings: ModelSettings): number {
  return settings.thinking === 'off' ? base : base + THINKING_HEADROOM_TOKENS
}

/**
 * Ajuste de UM modelo numa tarefa direto do jsonb cru (as rotas de Geração já leem a linha inteira de
 * `app_config`): o salvo para o modelo, senão o default da tarefa para ele.
 */
export function settingsForModel(task: AiTask, rawAiTasks: unknown, model: string): ModelSettings {
  return parseStoredAiTasks(rawAiTasks)[task]?.byModel?.[model] ?? defaultSettings(task, model)
}
