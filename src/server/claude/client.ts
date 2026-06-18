/**
 * Seam ÚNICO e mockável para o cliente do Claude (Anthropic).
 *
 * Na fundação (#2) a interface era mínima — só `echo` — o suficiente para provar
 * que toda chamada ao Claude passa por uma interface e que o teste pode trocá-la por
 * um dublê determinístico sem tocar a rede.
 *
 * A issue #8 (dona do kernel de geração) ESTENDE esta interface com `generateRecipe`,
 * já com a forma real: structured outputs via schema canônico (`RecipeGenSchema` +
 * `zodOutputFormat`), e o RESULTADO CRU DA FRONTEIRA (`GenerationOutput`) que o kernel
 * puro `classify` (em `@/domain/generation`) mapeia para a taxonomia. O comentário
 * consultivo (`advisory`) trafega FORA da Receita (ADR-0009).
 *
 * `GenerationOutput` vive no DOMÍNIO (`@/domain/generation`) e é importado AQUI (server
 * → domínio), nunca o contrário: mantém a fronteira sem cheiro de domínio→server.
 */

import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'

import type { GenerationOutput } from '@/domain/generation'
import type { TranscriptMessage } from '@/domain/transcript'
import { RecipeGenSchema } from '@/domain/recipe-gen-schema'

/**
 * Forma da entrada da geração (em #8, mínima: o prompt já montado vive a montante).
 * #11/#12 montam o prompt; #8 só transporta. `model` é resolvido de
 * `app_config.default_model` na rota.
 */
export type GenerationInput = {
  systemPrompt: string
  userPrompt: string
  model: string
}

/**
 * Entrada do streaming da conversa (#12, ADR-0009 — DUAS chamadas distintas ao Claude). A
 * 1ª (esta) STREAMA texto token-a-token; a 2ª (DESTILAÇÃO) reusa `generateRecipe` VERBATIM
 * (single-shot, structured output). `transcript` é a Transcrição validada; `systemPrompt` é
 * o de conversa (NÃO o de destilação — esse vive na chamada `generateRecipe`).
 */
export type ConversationStreamInput = {
  systemPrompt: string
  transcript: ReadonlyArray<TranscriptMessage>
  model: string
}

export interface ClaudeClient {
  echo(text: string): Promise<string>
  generateRecipe(input: GenerationInput): Promise<GenerationOutput>
  // Streaming conversacional: rende deltas de texto. A conclusão do iterável é o sinal
  // terminal (SEM sentinela). #12 só consome o texto; thinking NÃO é rendido.
  streamConversation(input: ConversationStreamInput): AsyncIterable<string>
}

// Teto de tokens da geração. Constrito o bastante para não estourar custo, largo o
// bastante para uma Receita completa; estourar → stop_reason 'max_tokens'.
const MAX_TOKENS = 4096

/**
 * Implementação real. `echo` segue puro (sem rede). `generateRecipe` usa structured
 * outputs (`messages.parse` + `zodOutputFormat(RecipeGenSchema)`).
 */
export class RealClaudeClient implements ClaudeClient {
  async echo(text: string): Promise<string> {
    return text
  }

  async generateRecipe(input: GenerationInput): Promise<GenerationOutput> {
    // Lazy: lê ANTHROPIC_API_KEY do ambiente só na chamada — NUNCA em teste (o teste
    // injeta FakeClaudeClient via setClaudeClient).
    const client = new Anthropic()

    try {
      const params = {
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        messages: [{ role: 'user' as const, content: input.userPrompt }],
        output_config: { format: zodOutputFormat(RecipeGenSchema) },
        // SEM prefill, SEM temperature custom, SEM thinking: claude-opus-4-8 rejeita
        // prefill/temperature com structured outputs (landmine §11).
      }

      let message = await client.messages.parse(params)

      // Branch por stop_reason (NÃO stop_details — esse é só metadado de categoria).
      if (message.stop_reason === 'refusal') return { kind: 'refusal' }
      // Uma resposta de saída estruturada TRUNCADA lança dentro de messages.parse e é
      // pega no catch como parse_failed; este branch só trata o sinal max_tokens
      // SEM truncamento do structured output.
      if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' }

      // Repair mínimo: se o parser não produziu saída, re-chama UMA vez com a mesma
      // entrada. Ainda null → parse_failed.
      if (message.parsed_output === null) {
        message = await client.messages.parse(params)
        if (message.stop_reason === 'refusal') return { kind: 'refusal' }
        if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' }
        if (message.parsed_output === null) return { kind: 'parse_failed' }
      }

      const parsed = message.parsed_output
      // `receita` já é null para impossible (regra de app no schema flat); sem ternário.
      return {
        kind: 'object',
        recipe: parsed.receita,
        advisory: parsed.advisory,
        modelKind: parsed.kind,
      }
    } catch {
      // Qualquer erro de rede/SDK/validação → parse_failed. Nunca vaza stack; nunca
      // vira Receita parcial.
      return { kind: 'parse_failed' }
    }
  }

  async *streamConversation(input: ConversationStreamInput): AsyncIterable<string> {
    // Lazy: lê ANTHROPIC_API_KEY do ambiente só na chamada — NUNCA em teste.
    const client = new Anthropic()

    const stream = client.messages.stream({
      model: input.model,
      max_tokens: MAX_TOKENS,
      system: input.systemPrompt,
      messages: input.transcript.map((m) => ({ role: m.role, content: m.content })),
      // Adaptive thinking; só rendemos TEXTO (thinking_delta é ignorado abaixo).
      thinking: { type: 'adaptive' },
    })

    // Rende SÓ os deltas de TEXTO (content_block_delta / text_delta). A conclusão do
    // iterável é o sinal terminal — sem sentinela.
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text
      }
    }
  }
}

/**
 * Dublê determinístico para testes. `echo` ecoa (ou aplica `reply`); `generateRecipe`
 * devolve o `GenerationOutput` enlatado no construtor — cada teste injeta UMA classe.
 */
export class FakeClaudeClient implements ClaudeClient {
  // `cannedTokens` é o TERCEIRO arg OPCIONAL (após reply, canned) — NUNCA reordenar: os
  // ~36 call sites de 2 args devem seguir compilando. Os tokens são rendidos por
  // `streamConversation`; a destilação que segue usa `canned` via `generateRecipe`.
  constructor(
    private readonly reply: (text: string) => string = (text) => text,
    private readonly canned?: GenerationOutput,
    private readonly cannedTokens?: string[],
  ) {}

  async echo(text: string): Promise<string> {
    return this.reply(text)
  }

  async generateRecipe(): Promise<GenerationOutput> {
    if (!this.canned) {
      throw new Error('FakeClaudeClient: nenhum GenerationOutput enlatado (passe-o no construtor).')
    }
    return this.canned
  }

  async *streamConversation(): AsyncIterable<string> {
    // Rende cada token enlatado e RETORNA (conclusão = terminal, sem sentinela).
    for (const token of this.cannedTokens ?? []) {
      yield token
    }
  }
}
