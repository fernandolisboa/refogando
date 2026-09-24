import Anthropic from '@anthropic-ai/sdk'
import { tuningParams, type ModelSettings } from '@/domain/ai-task-config'

/**
 * Chamada MÍNIMA de teste de um modelo + ajuste (ADR-0034). A Models API informa esforço e thinking
 * adaptativo, mas não tudo (ex.: se o thinking pode ser DESLIGADO — o Opus 5.5 recusa), então o admin
 * valida a combinação com uma requisição real antes de gravar. Custa frações de centavo. Seam próprio
 * (deps.ts): testes injetam um dublê via `setModelProbe`.
 */
export type ProbeResult =
  | { kind: 'ok' }
  // A API RECUSOU a combinação (400/404): ex. `thinking: disabled` num modelo que não desliga.
  | { kind: 'rejected'; message: string }
  // Não deu para testar (sem chave, rede, 5xx, rate limit): o chamador grava sem verificar.
  | { kind: 'unavailable' }

export interface ModelProbe {
  probe(model: string, settings: ModelSettings): Promise<ProbeResult>
}

// Requisição mínima; sem resposta rápida, "não deu p/ testar".
const PROBE_TIMEOUT_MS = 20_000
// Sobra p/ um thinking curto; ninguém lê a resposta.
const PROBE_MAX_TOKENS = 512

export class RealModelProbe implements ModelProbe {
  async probe(model: string, settings: ModelSettings): Promise<ProbeResult> {
    try {
      // Lazy: lê ANTHROPIC_API_KEY só na chamada (sem chave ⇒ lança ⇒ `unavailable`).
      const client = new Anthropic({ maxRetries: 0, timeout: PROBE_TIMEOUT_MS })
      const { thinking, effort } = tuningParams(settings)
      await client.messages.create({
        model,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: 'user', content: 'Responda só: ok' }],
        ...(thinking ? { thinking } : {}),
        ...(effort ? { output_config: { effort } } : {}),
      })
      return { kind: 'ok' }
    } catch (err) {
      // 400 = combinação recusada; 404 = modelo inexistente. A mensagem da API diz o motivo e vai p/
      // o admin (admin-only), com teto de tamanho.
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
        return { kind: 'rejected', message: String(err.message).slice(0, 300) }
      }
      const e = (err ?? {}) as { name?: string; status?: number }
      console.error('[claude/probe] chamada de teste indisponível:', { name: e.name, status: e.status })
      return { kind: 'unavailable' }
    }
  }
}
