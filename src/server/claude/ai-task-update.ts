import {
  isModelId,
  parseModelSettings,
  type ModelSettings,
} from '@/domain/ai-task-config'
import { selectableFamilyOf, type ModelOption } from '@/domain/claude-models'
import { loadSelectableModels, type ModelCatalog, type SelectableModels } from '@/server/claude/model-catalog'
import type { ModelProbe } from '@/server/claude/model-probe'

/**
 * Validação de uma troca de modelo/ajuste vinda do admin (ADR-0033/0034). Três portões, do mais
 * barato ao mais caro: o modelo é oferecível; o ajuste cabe nas capacidades que a Models API informa;
 * a Anthropic aceita a combinação de verdade (chamada de teste). Só a última pega o que a API não
 * informa — ex.: desligar o thinking num modelo que não desliga.
 */

// Com a lista em fallback, aceita IDs das famílias selecionáveis no formato atual
// (`claude-<família>-<maior>[-<menor>]`), nunca um ID arbitrário.
const CURRENT_ID_SHAPE = /^claude-(opus|sonnet|fable)-\d+(-\d+)?$/

/**
 * Modelo aceitável para uma tarefa:
 *  - um da lista selecionável viva;
 *  - com a lista em FALLBACK (API fora nesta instância), um ID de família selecionável no formato
 *    atual: o cache é por instância, então o GET pode ter vindo de uma instância com a lista viva
 *    (modelo novo) e o PUT cair numa sem;
 *  - o que já está em uso na tarefa (re-salvar sem mudar o modelo não vira erro quando ele sai da lista).
 */
export function isAcceptableModel(model: string, currentModel: string, selectable: SelectableModels): boolean {
  if (selectable.models.some((opt) => opt.id === model)) return true
  if (selectable.source === 'fallback' && selectableFamilyOf(model) !== null && CURRENT_ID_SHAPE.test(model)) {
    return true
  }
  return model === currentModel
}

/** O ajuste respeita as capacidades declaradas? Sem capacidades conhecidas ⇒ passa (a chamada de teste decide). */
export function fitsCapabilities(option: ModelOption | undefined, settings: ModelSettings): boolean {
  const caps = option?.capabilities
  if (!caps) return true
  if (settings.effort && !caps.effort.includes(settings.effort)) return false
  if (settings.thinking === 'adaptive' && !caps.adaptiveThinking) return false
  return true
}

export type AiTaskUpdate =
  | { ok: true; model: string; settings: ModelSettings }
  | { ok: false; error: 'config_invalida' | 'modelo_invalido' | 'ajuste_nao_suportado' }
  | { ok: false; error: 'ajuste_recusado'; message: string }

export async function validateAiTaskUpdate(
  raw: unknown,
  currentModel: string,
  deps: { catalog: ModelCatalog; probe: ModelProbe },
): Promise<AiTaskUpdate> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'config_invalida' }
  const { model, settings: rawSettings } = raw as { model?: unknown; settings?: unknown }
  const settings = parseModelSettings(rawSettings)
  if (!isModelId(model) || !settings) return { ok: false, error: 'config_invalida' }

  const selectable = await loadSelectableModels(deps.catalog)
  if (!isAcceptableModel(model, currentModel, selectable)) return { ok: false, error: 'modelo_invalido' }
  if (!fitsCapabilities(selectable.models.find((opt) => opt.id === model), settings)) {
    return { ok: false, error: 'ajuste_nao_suportado' }
  }

  // Sem como testar (sem chave, rede, 5xx) ⇒ grava sem verificar: não trava o admin por uma queda.
  const probe = await deps.probe.probe(model, settings)
  if (probe.kind === 'rejected') return { ok: false, error: 'ajuste_recusado', message: probe.message }
  return { ok: true, model, settings }
}

