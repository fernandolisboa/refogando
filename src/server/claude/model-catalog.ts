import Anthropic from '@anthropic-ai/sdk'
import {
  FALLBACK_SELECTABLE_MODELS,
  latestPerFamily,
  type CatalogModel,
  type ModelOption,
} from '@/domain/claude-models'

/**
 * Seam da Models API da Anthropic (`GET /v1/models`) — alimenta o select de modelo do admin. Produção
 * usa `RealModelCatalog`; testes injetam um dublê via `setModelCatalog` (deps.ts). A regra de seleção
 * (famílias + mais novo de cada) é pura, em `domain/claude-models.ts`.
 */
export interface ModelCatalog {
  /** Lista crua da Models API. Lança em erro de rede/credencial (o chamador faz o fallback). */
  listModels(): Promise<CatalogModel[]>
}

// Sucesso vale 1h (lançamento de modelo é raro; o admin não precisa de tempo real). Falha vale 5 min:
// não martela a API nem deixa a aba do admin lenta a cada abertura enquanto ela está fora.
export const SUCCESS_TTL_MS = 60 * 60 * 1000
export const FAILURE_TTL_MS = 5 * 60 * 1000
// Prazo TOTAL da listagem (todas as páginas): a lista é um detalhe da aba admin; sem resposta rápida,
// cai na lista pinada.
const LIST_DEADLINE_MS = 5_000

async function fetchFromAnthropic(): Promise<CatalogModel[]> {
  // Lazy: lê ANTHROPIC_API_KEY só na chamada (sem chave ⇒ o construtor lança ⇒ fallback).
  const client = new Anthropic({ maxRetries: 0 })
  const signal = AbortSignal.timeout(LIST_DEADLINE_MS)
  const models: CatalogModel[] = []
  for await (const m of client.models.list({ limit: 100 }, { signal })) {
    models.push({ id: m.id, displayName: m.display_name, createdAt: m.created_at })
  }
  return models
}

export class RealModelCatalog implements ModelCatalog {
  private cache: { at: number; ttl: number; value: Promise<CatalogModel[]> } | null = null

  // `fetchAll`/`now` injetáveis só p/ testar o cache sem rede nem relógio real.
  constructor(
    private readonly fetchAll: () => Promise<CatalogModel[]> = fetchFromAnthropic,
    private readonly now: () => number = Date.now,
  ) {}

  listModels(): Promise<CatalogModel[]> {
    const now = this.now()
    if (this.cache && now - this.cache.at < this.cache.ttl) return this.cache.value
    // A promessa entra no cache ANTES de resolver: chamadas concorrentes dividem uma só busca.
    const value = this.fetchAll()
    const entry = { at: now, ttl: SUCCESS_TTL_MS, value }
    this.cache = entry
    // Falha ⇒ encurta o TTL desta entrada (a próxima leitura depois de 5 min tenta de novo).
    value.catch(() => {
      entry.ttl = FAILURE_TTL_MS
    })
    return value
  }
}

export type SelectableModels = {
  models: ModelOption[]
  /** `live` = Models API; `fallback` = lista pinada (API fora, sem chave ou sem família nossa). */
  source: 'live' | 'fallback'
}

/**
 * Modelos que o admin pode escolher agora: o mais novo de cada família selecionável segundo a Models
 * API; em qualquer falha (ou lista sem nenhuma família nossa), a lista pinada. Nunca lança, nunca [].
 */
export async function loadSelectableModels(catalog: ModelCatalog): Promise<SelectableModels> {
  try {
    const live = latestPerFamily(await catalog.listModels())
    if (live.length > 0) return { models: live, source: 'live' }
  } catch (err) {
    const e = (err ?? {}) as { name?: string; status?: number }
    console.error('[claude/models] Models API indisponível (→ lista pinada):', {
      name: e.name,
      status: e.status,
    })
  }
  return { models: [...FALLBACK_SELECTABLE_MODELS], source: 'fallback' }
}
