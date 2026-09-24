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
const SUCCESS_TTL_MS = 60 * 60 * 1000
const FAILURE_TTL_MS = 5 * 60 * 1000
// Teto curto: a lista é um detalhe da aba admin; sem resposta rápida, cai na lista pinada.
const REQUEST_TIMEOUT_MS = 5_000

export class RealModelCatalog implements ModelCatalog {
  private cache: { at: number; ttl: number; value: Promise<CatalogModel[]> } | null = null

  listModels(): Promise<CatalogModel[]> {
    const now = Date.now()
    if (this.cache && now - this.cache.at < this.cache.ttl) return this.cache.value
    const value = this.fetchAll()
    const entry = { at: now, ttl: SUCCESS_TTL_MS, value }
    this.cache = entry
    // Falha ⇒ encurta o TTL desta entrada (a próxima leitura depois de 5 min tenta de novo).
    value.catch(() => {
      entry.ttl = FAILURE_TTL_MS
    })
    return value
  }

  private async fetchAll(): Promise<CatalogModel[]> {
    // Lazy: lê ANTHROPIC_API_KEY só na chamada (sem chave ⇒ o construtor lança ⇒ fallback).
    const client = new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 })
    const models: CatalogModel[] = []
    for await (const m of client.models.list({ limit: 100 })) {
      models.push({ id: m.id, displayName: m.display_name, createdAt: m.created_at })
    }
    return models
  }
}

/**
 * Modelos que o admin pode escolher agora: o mais novo de cada família selecionável segundo a Models
 * API; em qualquer falha (ou lista sem nenhuma família nossa), a lista pinada. Nunca lança, nunca [].
 */
export async function loadSelectableModels(catalog: ModelCatalog): Promise<ModelOption[]> {
  try {
    const live = latestPerFamily(await catalog.listModels())
    if (live.length > 0) return live
  } catch (err) {
    const e = (err ?? {}) as { name?: string; status?: number }
    console.error('[claude/models] Models API indisponível (→ lista pinada):', {
      name: e.name,
      status: e.status,
    })
  }
  return [...FALLBACK_SELECTABLE_MODELS]
}
