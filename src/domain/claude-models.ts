/**
 * Modelos de TEXTO selecionáveis pelo admin (default_model da Geração) — PURO: tipos + default + regra
 * de seleção sobre a lista da Models API da Anthropic. Sem I/O (o fetch + cache vivem no seam
 * `server/claude/model-catalog.ts`).
 *
 * Por que DINÂMICO na OFERTA e FIXO no DEFAULT:
 *  - A lista do admin vem da Models API (`GET /v1/models`): quando a Anthropic lança um Opus/Sonnet/Fable
 *    novo, ele aparece no select sem deploy. Filtramos por FAMÍLIA (allowlist) e ficamos com o MAIS NOVO
 *    de cada uma — Haiku e Mythos ficam de fora de propósito.
 *  - O modelo EM USO nunca troca sozinho: só muda quando o admin salva. Um modelo novo pode trazer
 *    breaking change de API (ex.: Opus 5.5 recusa `thinking: disabled`), então a troca é uma decisão.
 *  - API fora do ar / sem chave ⇒ `FALLBACK_SELECTABLE_MODELS` (pinados aqui), nunca uma lista vazia.
 *
 * Histórico: `generation.model` guarda o ID cru que gerou cada Receita. Nada aqui reescreve esse campo;
 * sair da lista selecionável NÃO apaga o modelo de linhas antigas (Haiku incluso).
 */

import { EFFORT_LEVELS, type EffortLevel } from '@/domain/ai-task-config'

/** Modelo default em código (sem linha em `app_config`) — fonte ÚNICA do default de chat/geração. */
export const DEFAULT_TEXT_MODEL = 'claude-opus-5-5'

/** Modelo default das tarefas Tradução e Extração (ADR-0034) enquanto o admin não escolhe outro. */
export const DEFAULT_TASK_MODEL = 'claude-sonnet-5'

/** Famílias que o admin pode escolher, na ordem em que aparecem no select. */
export const SELECTABLE_FAMILIES = ['opus', 'sonnet', 'fable'] as const
export type SelectableFamily = (typeof SELECTABLE_FAMILIES)[number]

/**
 * O que o modelo aceita, segundo a Models API (`capabilities`): os níveis de `effort` e se tem thinking
 * adaptativo. A API NÃO diz se o thinking pode ser DESLIGADO — isso a chamada de teste ao salvar cobre.
 * `null` = API sem o bloco de capacidades (a UI oferece tudo e a chamada de teste decide).
 */
export type ModelCaps = {
  effort: EffortLevel[]
  adaptiveThinking: boolean
}

/** Uma opção de modelo (forma estável, agnóstica do SDK). */
export type ModelOption = {
  id: string
  displayName: string
  family: SelectableFamily
  capabilities: ModelCaps | null
}

/** Entrada crua da Models API (só os campos que usamos). `createdAt` é RFC 3339. */
export type CatalogModel = {
  id: string
  displayName: string
  createdAt: string
  capabilities?: ModelCaps | null
}

/**
 * Lista pinada — usada quando a Models API não responde. Atualizar aqui é opcional (a lista viva
 * já cobre modelos novos); só garante que o admin nunca fica sem opção.
 */
const ALL_CAPS: ModelCaps = { effort: [...EFFORT_LEVELS], adaptiveThinking: true }
export const FALLBACK_SELECTABLE_MODELS: readonly ModelOption[] = [
  { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', family: 'opus', capabilities: ALL_CAPS },
  { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', family: 'sonnet', capabilities: ALL_CAPS },
  { id: 'claude-fable-5-1', displayName: 'Claude Fable 5.1', family: 'fable', capabilities: ALL_CAPS },
]

const FAMILY_RE = /^claude-([a-z]+)-/

/** Família do ID (`claude-opus-5-5` → `opus`), ou `null` se não for uma família selecionável. */
export function selectableFamilyOf(id: string): SelectableFamily | null {
  const family = FAMILY_RE.exec(id)?.[1]
  return (SELECTABLE_FAMILIES as readonly string[]).includes(family ?? '')
    ? (family as SelectableFamily)
    : null
}

/**
 * Da lista crua da Models API, o MAIS NOVO (`createdAt`) de cada família selecionável, na ordem de
 * `SELECTABLE_FAMILIES`. Família sem nenhum modelo na lista fica de fora. Lista vazia ⇒ [] (o chamador
 * decide o fallback). Empate/data inválida ⇒ fica o primeiro visto (a API já ordena do mais novo).
 */
export function latestPerFamily(models: readonly CatalogModel[]): ModelOption[] {
  const best = new Map<SelectableFamily, { model: CatalogModel; ts: number }>()
  for (const model of models) {
    const family = selectableFamilyOf(model.id)
    if (!family) continue
    const ts = Date.parse(model.createdAt)
    const current = best.get(family)
    if (!current || (Number.isFinite(ts) && (!Number.isFinite(current.ts) || ts > current.ts))) {
      best.set(family, { model, ts })
    }
  }
  return SELECTABLE_FAMILIES.flatMap((family) => {
    const hit = best.get(family)
    return hit
      ? [
          {
            id: hit.model.id,
            displayName: hit.model.displayName,
            family,
            capabilities: hit.model.capabilities ?? null,
          },
        ]
      : []
  })
}
