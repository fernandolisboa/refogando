/**
 * Modelos de TEXTO selecionáveis pelo admin (default_model da Geração) — PURO: tipos + default + regra
 * de seleção sobre a lista da Models API da Anthropic. Sem I/O (o fetch + cache vivem no seam
 * `server/claude/model-catalog.ts`).
 *
 * Por que DINÂMICO na OFERTA e FIXO no DEFAULT:
 *  - A lista do admin vem da Models API (`GET /v1/models`): quando a Anthropic lança um Opus/Sonnet/Haiku
 *    novo, ele aparece no select sem deploy. Filtramos por FAMÍLIA (allowlist) e ficamos com o MAIS NOVO
 *    de cada uma — Fable e Mythos ficam de fora de propósito (desde 2026-10-16 o app usa só Haiku,
 *    Sonnet e Opus; hoje os três na 5.5).
 *  - O modelo EM USO só troca depois de uma chamada de teste aceita: quando o admin salva, ou no cron
 *    diário que leva cada tarefa ao mais novo da MESMA família (ADR-0046, `model-auto-upgrade.ts`). Um
 *    modelo novo pode trazer breaking change de API (ex.: Opus 5.5 recusa `thinking: disabled`).
 *  - API fora do ar / sem chave ⇒ `FALLBACK_SELECTABLE_MODELS` (pinados aqui), nunca uma lista vazia.
 *
 * Histórico: `generation.model` guarda o ID cru que gerou cada Receita. Nada aqui reescreve esse campo;
 * sair da lista selecionável NÃO apaga o modelo de linhas antigas (Fable incluso).
 */

import { EFFORT_LEVELS, type EffortLevel } from '@/domain/ai-task-config'

/** Modelo default em código (sem linha em `app_config`) — fonte ÚNICA do default de chat/geração. */
export const DEFAULT_TEXT_MODEL = 'claude-opus-5-5'

/** Modelo default das tarefas Tradução e Extração (ADR-0034) enquanto o admin não escolhe outro. */
export const DEFAULT_TASK_MODEL = 'claude-sonnet-5-5'

/** Famílias que o admin pode escolher, na ordem em que aparecem no select. */
export const SELECTABLE_FAMILIES = ['opus', 'sonnet', 'haiku'] as const
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
  { id: 'claude-sonnet-5-5', displayName: 'Claude Sonnet 5.5', family: 'sonnet', capabilities: ALL_CAPS },
  { id: 'claude-haiku-5-5', displayName: 'Claude Haiku 5.5', family: 'haiku', capabilities: ALL_CAPS },
]

const FAMILY_RE = /^claude-([a-z]+)-/

/**
 * O modelo aceita `output_config.effort`? Todas as famílias selecionáveis aceitam, menos o Haiku 4.5
 * (legado, dá 400 com `effort`). Fora das famílias selecionáveis ⇒ não manda (cada modelo no default).
 * Guarda de LEGADO (o Haiku 4.5 nem é oferecido): o único ponto em que um esforço salvo é descartado
 * em silêncio, para uma linha antiga não quebrar a chamada.
 */
export function acceptsEffort(id: string): boolean {
  return selectableFamilyOf(id) !== null && !id.startsWith('claude-haiku-4')
}

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
