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
import type { PromptAxes } from '@/domain/briefing'
import { buildRecipeGenSchema } from '@/domain/recipe-gen-schema'
import {
  IngredientExtractionSchema,
  EXTRACTION_MAX_TOKENS,
  type ExtractionOutput,
} from '@/domain/ingredient-extraction'

/**
 * Forma da entrada da geração (em #8, mínima: o prompt já montado vive a montante).
 * #11/#12 montam o prompt; #8 só transporta. `model` é resolvido de
 * `app_config.default_model` na rota.
 */
export type GenerationInput = {
  systemPrompt: string
  userPrompt: string
  model: string
  // OPCIONAL (back-compat: todos os call sites de #8/#11/#88 seguem compilando). #12 passa
  // o `req.signal`: se o cliente HTTP desconecta antes da destilação, o abort propaga ao SDK
  // e a chamada (parse) é cancelada — não se queima quota gerando p/ um cliente que sumiu.
  signal?: AbortSignal
  // Conjunto ATIVO de slugs de cozinha (#318, ADR-0025 Decisão 4): constrange `cozinha` na saída
  // structured (`buildRecipeGenSchema` → zodOutputFormat) ao vocabulário VIVO — o modelo só emite
  // cozinhas ativas. OPCIONAL (back-compat): ausente/vazio ⇒ `z.string()` (sem constraint). A
  // BORDA resolve o conjunto (loadActiveCozinhaSlugs); o FakeClaudeClient o ignora (devolve canned).
  cozinhaSlugs?: readonly string[]
  // Eixos de composição do prompt (#420, ADR-0029): resolvidos na BORDA e já EMBUTIDOS no
  // `systemPrompt` (via buildSystemPrompt). Trafegam aqui como PROVENIÊNCIA da geração (o que a
  // produziu), espelhando `cozinhaSlugs` como campo OPCIONAL/back-compat. O RealClaudeClient NÃO os
  // relê (o systemPrompt já os codifica); a BORDA carimba a versão separadamente via `promptStampFor`
  // no persist. OPCIONAL: ausente ⇒ eixos neutros. O FakeClaudeClient os ignora (devolve canned).
  axes?: PromptAxes
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
  // OPCIONAL: o `req.signal` da rota. Em disconnect, o abort propaga ao SDK e o stream é
  // cancelado — o servidor para de consumir o stream do LLM (e a destilação é pulada).
  signal?: AbortSignal
}

export interface ClaudeClient {
  echo(text: string): Promise<string>
  generateRecipe(input: GenerationInput): Promise<GenerationOutput>
  // Streaming conversacional: rende deltas de texto. A conclusão do iterável é o sinal
  // terminal (SEM sentinela). #12 só consome o texto; thinking NÃO é rendido.
  streamConversation(input: ConversationStreamInput): AsyncIterable<string>
  // Extração de ingredientes (#112): ORGANIZA o texto natural do Usuário em itens
  // estruturados (NÃO gera Receita). Mesma disciplina de structured output de
  // generateRecipe (messages.parse + reparo), mas no `IngredientExtractionSchema` e com
  // um teto de tokens próprio. Reusa `GenerationInput` (já carrega systemPrompt/userPrompt/
  // model/signal) — a rota passa `model: EXTRACTION_MODEL` (modelo BARATO, não o default).
  extractIngredients(input: GenerationInput): Promise<ExtractionOutput>
}

// Teto de tokens da geração. Constrito o bastante para não estourar custo, largo o
// bastante para uma Receita completa; estourar → stop_reason 'max_tokens'.
const MAX_TOKENS = 4096

// Modelo default em código quando `app_config.default_model` (linha singleton) está
// ausente. FONTE ÚNICA: ambas as rotas de geração (/api/generations e
// /api/conversations/stream) resolvem o modelo de app_config e caem AQUI no default.
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-8'

// Modelo DEDICADO e BARATO da Extração de ingredientes (#112). Env-overridable. NÃO é o
// `app_config.default_model` compartilhado da Geração (esse é o OPUS de qualidade): a Extração
// só organiza uma lista — usar o modelo caro derrotaria o objetivo de custo. A rota de
// parse-ingredients usa ESTA constante diretamente e NÃO lê app_config nem ALLOWED_MODELS.
export const EXTRACTION_MODEL = process.env.EXTRACTION_MODEL ?? 'claude-haiku-4-5-20251001'

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
      // #318: schema constrito ao conjunto ATIVO de cozinhas (data-driven, ADR-0025). Vazio ⇒
      // z.string() (sem constraint). Mesmo schema p/ a chamada inicial E o reparo abaixo.
      const schema = buildRecipeGenSchema(input.cozinhaSlugs ?? [])
      const params = {
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        messages: [{ role: 'user' as const, content: input.userPrompt }],
        output_config: { format: zodOutputFormat(schema) },
        // SEM prefill, SEM temperature custom, SEM thinking: claude-opus-4-8 rejeita
        // prefill/temperature com structured outputs (landmine §11).
      }

      // O `signal` (opcional) propaga o abort do cliente HTTP ao SDK: se a requisição
      // já foi abortada, a chamada estoura e cai no catch (parse_failed) sem queimar quota.
      let message = await client.messages.parse(params, { signal: input.signal })

      // Branch por stop_reason (NÃO stop_details — esse é só metadado de categoria).
      if (message.stop_reason === 'refusal') return { kind: 'refusal' }
      // Uma resposta de saída estruturada TRUNCADA lança dentro de messages.parse e é
      // pega no catch como parse_failed; este branch só trata o sinal max_tokens
      // SEM truncamento do structured output.
      if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' }

      // Repair mínimo: se o parser não produziu saída, re-chama UMA vez com a mesma
      // entrada. Ainda null → parse_failed.
      if (message.parsed_output === null) {
        message = await client.messages.parse(params, { signal: input.signal })
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

  async extractIngredients(input: GenerationInput): Promise<ExtractionOutput> {
    // Espelha generateRecipe (mesma disciplina ADR-0009: messages.parse + zodOutputFormat +
    // reparo de UMA tentativa), mas no IngredientExtractionSchema e com o teto de tokens da
    // Extração. Lazy: lê ANTHROPIC_API_KEY só na chamada — NUNCA em teste (o teste injeta o
    // FakeClaudeClient). QUALQUER throw/null após o reparo → parse_failed (nunca vaza stack
    // nem item parcial). NÃO ramifica por stop_reason em refusal/max_tokens: para a Extração,
    // qualquer não-sucesso é simplesmente parse_failed (a rota mapeia para 502).
    const client = new Anthropic()

    try {
      const params = {
        model: input.model,
        max_tokens: EXTRACTION_MAX_TOKENS,
        system: input.systemPrompt,
        messages: [{ role: 'user' as const, content: input.userPrompt }],
        output_config: { format: zodOutputFormat(IngredientExtractionSchema) },
      }

      let message = await client.messages.parse(params, { signal: input.signal })

      // Reparo mínimo: se o parser não produziu saída, re-chama UMA vez. Ainda null →
      // parse_failed.
      if (message.parsed_output === null) {
        message = await client.messages.parse(params, { signal: input.signal })
        if (message.parsed_output === null) return { kind: 'parse_failed' }
      }

      return { kind: 'ok', items: message.parsed_output.items }
    } catch {
      return { kind: 'parse_failed' }
    }
  }

  async *streamConversation(input: ConversationStreamInput): AsyncIterable<string> {
    // Lazy: lê ANTHROPIC_API_KEY do ambiente só na chamada — NUNCA em teste.
    const client = new Anthropic()

    const stream = client.messages.stream(
      {
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        messages: input.transcript.map((m) => ({ role: m.role, content: m.content })),
        // Adaptive thinking; só rendemos TEXTO (thinking_delta é ignorado abaixo).
        thinking: { type: 'adaptive' },
      },
      // `signal` (opcional): em disconnect do cliente HTTP, o abort cancela o stream do SDK.
      { signal: input.signal },
    )

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
  // `cannedTokens` é o TERCEIRO arg OPCIONAL (após reply, canned) — NUNCA reordenar: o 3º
  // arg é OPCIONAL e vem DEPOIS de (reply, canned) para que os call sites de 2 args
  // existentes continuem compilando. Os tokens são rendidos por `streamConversation`; a
  // destilação que segue usa `canned` via `generateRecipe`.
  // `cannedExtraction` (#112) é o QUARTO arg OPCIONAL — vem DEPOIS dos três para que TODOS os
  // call sites existentes (`new FakeClaudeClient(reply, canned, cannedTokens)`) compilem sem
  // mudança. `extractIngredients` o devolve, ou estoura se ausente.
  constructor(
    private readonly reply: (text: string) => string = (text) => text,
    private readonly canned?: GenerationOutput,
    private readonly cannedTokens?: string[],
    private readonly cannedExtraction?: ExtractionOutput,
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

  async extractIngredients(): Promise<ExtractionOutput> {
    if (!this.cannedExtraction) {
      throw new Error(
        'FakeClaudeClient: nenhum ExtractionOutput enlatado (passe-o como 4º arg do construtor).',
      )
    }
    return this.cannedExtraction
  }

  async *streamConversation(input?: ConversationStreamInput): AsyncIterable<string> {
    // Rende cada token enlatado e RETORNA (conclusão = terminal, sem sentinela). Entre
    // os yields, checa o `signal?.aborted` para ser abortável (o teste de disconnect aborta
    // após o 1º token e espera que o loop pare aqui, pulando a destilação).
    for (const token of this.cannedTokens ?? []) {
      if (input?.signal?.aborted) return
      yield token
    }
  }
}
