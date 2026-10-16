import type { Database } from '@/db/client'
import { appConfig } from '@/db/schema'
import {
  AI_TASKS,
  parseStoredAiTasks,
  resolveAiTasks,
  upgradeCandidates,
  withTaskSettings,
  type AiTask,
  type ModelSettings,
} from '@/domain/ai-task-config'
import { latestPerFamily, selectableFamilyOf, type CatalogModel, type ModelOption } from '@/domain/claude-models'
import { isNewerVersion } from '@/domain/model-id'
import { TEXT_PRICE_TABLE } from '@/domain/text-cost'
import { loadAppConfig, TASK_FALLBACK_MODELS } from '@/server/app-config'
import { APP_CONFIG_TAG, expireCacheTag } from '@/server/cache-tags'
import type { ModelCatalog } from '@/server/claude/model-catalog'
import type { ModelProbe } from '@/server/claude/model-probe'

/**
 * Troca AUTOMÁTICA de versão do modelo de cada tarefa de IA (ADR-0046). A
 * Anthropic lança versão nova com frequência; o dono não quer pedir ajuste a cada lançamento. Uma vez por
 * dia (cron `/api/cron/ai-models`), para cada tarefa com "Atualizar sozinho" ligado:
 *  1. pega o mais novo da MESMA família do modelo em uso, segundo a Models API (só a lista VIVA: com a
 *     API fora, não troca nada e tenta amanhã);
 *  2. se for outro modelo, testa os ajustes de `upgradeCandidates` com uma chamada real, em ordem, até a
 *     Anthropic aceitar um (modelo novo costuma recusar parâmetro do anterior);
 *  3. aceito ⇒ grava modelo + ajuste (o mesmo caminho do admin); todos recusados ⇒ fica no atual e loga;
 *     teste indisponível (rede, 5xx, sem chave) ⇒ para a passada (as tarefas restantes também ficam) e
 *     tenta amanhã.
 * Orçamento de tempo: não começa chamada de teste nova depois de `PROBE_BUDGET_MS` (a rota tem 60s e
 * cada chamada pode levar até 20s); o que sobrar fica para amanhã (`semTempo`). Tarefas que sobem para
 * o mesmo modelo reaproveitam o resultado do teste de um mesmo ajuste.
 * O modelo em uso continua mudando só depois de uma chamada de teste aceita (a trava do #547), agora sem
 * depender de alguém salvar. Família nunca muda sozinha (um Sonnet não vira Opus).
 */

export type UpgradeOutcome =
  | { task: AiTask; kind: 'fixo' } // interruptor desligado no admin
  | { task: AiTask; kind: 'atual'; model: string } // já está no mais novo da família
  | { task: AiTask; kind: 'foraDaFamilia'; model: string } // modelo fora das famílias selecionáveis
  | { task: AiTask; kind: 'naoMaisNovo'; model: string } // o "mais novo" listado não é mais novo que o em uso
  | { task: AiTask; kind: 'trocado'; from: string; to: string; settings: ModelSettings }
  | { task: AiTask; kind: 'recusado'; from: string; to: string }
  | { task: AiTask; kind: 'semTeste'; from: string; to: string }
  | { task: AiTask; kind: 'semTempo'; from: string; to: string } // orçamento de tempo da passada esgotado
  | { task: AiTask; kind: 'mudouNoMeio'; from: string; to: string } // admin salvou durante a passada

export type UpgradeSummary =
  | { kind: 'semLista' } // Models API indisponível: nada muda
  | { kind: 'ok'; outcomes: UpgradeOutcome[] }

const describe = (s: ModelSettings) => `thinking=${s.thinking} effort=${s.effort ?? 'default'}`

// Sem chamada de teste nova depois disto: a pior chamada (20s) ainda termina antes dos 60s da rota.
export const PROBE_BUDGET_MS = 35_000

export async function autoUpgradeModels(
  db: Database,
  deps: { catalog: ModelCatalog; probe: ModelProbe; now?: () => number },
): Promise<UpgradeSummary> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  let raw: CatalogModel[]
  try {
    raw = await deps.catalog.listModels()
  } catch (err) {
    console.warn(`[ai-models] Models API indisponível: ${err instanceof Error ? err.name : 'erro'}; nada muda`)
    return { kind: 'semLista' }
  }
  const latest = latestPerFamily(raw)
  if (latest.length === 0) {
    console.warn('[ai-models] Models API sem nenhuma família nossa; nada muda')
    return { kind: 'semLista' }
  }

  const cfg = await loadAppConfig(db)
  const outcomes: UpgradeOutcome[] = []
  // Resultado por (modelo, ajuste): Tradução, Extração e Cenário costumam subir para o mesmo Sonnet.
  const probed = new Map<string, Awaited<ReturnType<ModelProbe['probe']>>>()
  const rejections = new Map<string, string>()
  let unavailable = false

  // Uma tarefa por vez: as escritas disputam o lock da mesma linha e o log fica em ordem.
  for (const task of AI_TASKS) {
    const state = cfg.aiTasks[task]
    if (!state.auto) {
      outcomes.push({ task, kind: 'fixo' })
      continue
    }
    const family = selectableFamilyOf(state.model)
    const next = family ? latest.find((opt) => opt.family === family) : undefined
    if (!family || !next) {
      outcomes.push({ task, kind: 'foraDaFamilia', model: state.model })
      continue
    }
    if (next.id === state.model) {
      outcomes.push({ task, kind: 'atual', model: state.model })
      continue
    }
    if (!isNewer(next, state.model, raw)) {
      // Nunca rebaixa: o modelo em uso pode faltar na lista (rollout, chave sem acesso, ID manual).
      outcomes.push({ task, kind: 'naoMaisNovo', model: state.model })
      continue
    }

    let accepted: ModelSettings | null = null
    let outOfTime = false
    for (const settings of upgradeCandidates(task, state, {
      id: next.id,
      effort: next.capabilities?.effort ?? null,
    })) {
      if (unavailable) break
      const key = `${next.id}|${describe(settings)}`
      let res = probed.get(key)
      if (!res) {
        if (now() - startedAt > PROBE_BUDGET_MS) {
          outOfTime = true
          break
        }
        res = await deps.probe.probe(next.id, settings)
        probed.set(key, res)
      }
      if (res.kind === 'ok') {
        accepted = settings
        break
      }
      if (res.kind === 'unavailable') unavailable = true
      else rejections.set(task, res.message)
    }

    if (!accepted) {
      const kind = unavailable ? 'semTeste' : outOfTime ? 'semTempo' : 'recusado'
      outcomes.push({ task, kind, from: state.model, to: next.id })
      continue
    }

    const wrote = await writeUpgrade(db, task, state.model, next.id, accepted)
    // Expira já: se a função morrer depois, a troca gravada não fica escondida atrás do cache.
    if (wrote) expireCacheTag(APP_CONFIG_TAG)
    outcomes.push(
      wrote
        ? { task, kind: 'trocado', from: state.model, to: next.id, settings: accepted }
        : { task, kind: 'mudouNoMeio', from: state.model, to: next.id },
    )
  }

  for (const o of outcomes) {
    if (o.kind === 'trocado') {
      console.info(`[ai-models] ${o.task}: ${o.from} → ${o.to} (${describe(o.settings)})`)
      if (!TEXT_PRICE_TABLE[o.to]) {
        console.warn(`[ai-models] ${o.to} sem preço em text-cost.ts: o custo das gerações fica em branco`)
      }
    } else if (o.kind === 'recusado') {
      // A mensagem da API (já com teto de 300 caracteres no probe) diz qual parâmetro foi recusado.
      const reason = rejections.get(o.task) ?? ''
      console.warn(`[ai-models] ${o.task}: ${o.to} recusou todos os ajustes; fica em ${o.from}. Último motivo: ${reason}`)
    } else if (o.kind === 'semTeste') {
      console.warn(`[ai-models] ${o.task}: sem como testar ${o.to} agora; fica em ${o.from}`)
    } else if (o.kind === 'semTempo') {
      console.warn(`[ai-models] ${o.task}: sem tempo nesta passada para testar ${o.to}; fica em ${o.from}`)
    }
  }
  return { kind: 'ok', outcomes }
}

/**
 * O candidato é mais novo que o modelo em uso? Com o em uso na lista, compara `createdAt`; sem ele (a
 * Models API não lista mais um modelo aposentado, ou nunca listou um ID manual), compara a versão do ID.
 */
function isNewer(next: ModelOption, current: string, raw: readonly CatalogModel[]): boolean {
  const cur = raw.find((m) => m.id === current)
  const nxt = raw.find((m) => m.id === next.id)
  const curTs = cur ? Date.parse(cur.createdAt) : NaN
  const nxtTs = nxt ? Date.parse(nxt.createdAt) : NaN
  if (Number.isFinite(curTs) && Number.isFinite(nxtTs)) return nxtTs > curTs
  return isNewerVersion(next.id, current)
}

/**
 * Grava a troca sob lock da linha, CONFERINDO que nada mudou desde a leitura (o admin pode ter salvo
 * outro modelo ou desligado o automático durante os testes). Mudou ⇒ não grava (`false`).
 */
async function writeUpgrade(
  db: Database,
  task: AiTask,
  from: string,
  to: string,
  settings: ModelSettings,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Garante a linha antes, p/ o FOR UPDATE ter o que travar (mesmo padrão do PUT do admin).
    await tx.insert(appConfig).values({ id: true }).onConflictDoNothing()
    const [row] = await tx
      .select({ defaultModel: appConfig.defaultModel, aiTasks: appConfig.aiTasks })
      .from(appConfig)
      .for('update')
    const stored = parseStoredAiTasks(row?.aiTasks)
    const generationModel = row?.defaultModel ?? from
    const now = resolveAiTasks(stored, { generation: generationModel, ...TASK_FALLBACK_MODELS })[task]
    if (now.model !== from || !now.auto) return false

    const aiTasks = withTaskSettings(stored, task, to, settings)
    const set = task === 'generation' ? { aiTasks, defaultModel: to } : { aiTasks }
    await tx
      .insert(appConfig)
      .values({ id: true, ...set })
      .onConflictDoUpdate({ target: appConfig.id, set: { ...set, updatedAt: new Date() } })
    return true
  })
}
