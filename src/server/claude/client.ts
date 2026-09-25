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

import { selectableFamilyOf } from '@/domain/claude-models'
import {
  TASK_DEFAULT_SETTINGS,
  maxTokensFor,
  tuningParams,
  type ModelSettings,
} from '@/domain/ai-task-config'
import type { GenerationOutput } from '@/domain/generation'
import type { TextUsage } from '@/domain/text-cost'
import type { TranscriptMessage } from '@/domain/transcript'
import type { PromptAxes } from '@/domain/briefing'
import {
  buildRecipeGenSchema,
  buildRecipeGenListSchema,
  type CampoDescartado,
} from '@/domain/recipe-gen-schema'
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
  // Ajustes do modelo p/ ESTA tarefa (ADR-0034): esforço e thinking escolhidos no admin. OPCIONAL
  // (back-compat): ausente ⇒ esforço medium nas famílias selecionáveis e thinking no default do modelo.
  settings?: ModelSettings
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
  // Ajuste da tarefa Geração no admin (ADR-0034): a conversa com o chef usa o mesmo. Ausente ⇒ o
  // default da tarefa.
  settings?: ModelSettings
}

export interface ClaudeClient {
  echo(text: string): Promise<string>
  generateRecipe(input: GenerationInput): Promise<GenerationOutput>
  // "Gerar 2, o usuário escolhe" (#423, ADR-0029 dec.6): UMA chamada structured cujo schema devolve uma
  // LISTA de 2 variações (buildRecipeGenListSchema). Mapeia cada item de `variacoes` p/ um GenerationOutput
  // (mesmo branch de stop_reason/parse_failed do single). CAMINHO NOVO paralelo — `generateRecipe` fica
  // INTACTO. SEM temperature/seed (o Opus 4.8 rejeita — a variedade vem do PROMPT). Truncamento (max_tokens
  // no meio da 2ª) OU cardinalidade ≠ 2 ⇒ trata como parse_failed do LOTE (`[{kind:'parse_failed'}]`),
  // erro de geração — NÃO inventa/degrada. `axes` só é PROVENIÊNCIA (o systemPrompt já os codifica).
  generateRecipeVariants(input: GenerationInput): Promise<GenerationOutput[]>
  // Streaming conversacional: rende deltas de texto. A conclusão do iterável é o sinal
  // terminal (SEM sentinela). #12 só consome o texto; thinking NÃO é rendido.
  streamConversation(input: ConversationStreamInput): AsyncIterable<string>
  // Extração de ingredientes (#112): ORGANIZA o texto natural do Usuário em itens
  // estruturados (NÃO gera Receita). Mesma disciplina de structured output de
  // generateRecipe (messages.parse + reparo), mas no `IngredientExtractionSchema` e com
  // um teto de tokens próprio. Reusa `GenerationInput` (já carrega systemPrompt/userPrompt/
  // model/signal) — a rota passa o modelo da tarefa Extração (ADR-0034), não o default da Geração.
  extractIngredients(input: GenerationInput): Promise<ExtractionOutput>
}

// Mapeia o `message.usage` cru da Anthropic → `TextUsage` normalizado (#463). DEFENSIVO e NULL-HONESTO:
// bloco de usage AUSENTE (o SDK mudou de forma) ⇒ `undefined` ⇒ custo/tokens NULL no ledger — NÃO finge
// 0 (espelha `mapGeminiUsage` do lado da imagem, que devolve undefined sem telemetria). Presente-mas-com-
// campo-faltando ⇒ default 0 nesse campo (telemetria presente, só aquele número ausente). NUNCA lança.
function mapTextUsage(usage: { input_tokens?: number; output_tokens?: number } | null | undefined): TextUsage | undefined {
  if (!usage) return undefined
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  }
}

// Teto de tokens da geração. É TETO, não custo (cobra-se o que sai). Largo porque o thinking entra na
// conta: Opus 5.5 e Fable rodam com thinking SEMPRE ligado (não dá p/ desligar), e 4096 truncava a
// Receita no meio → stop_reason 'max_tokens'. Estourar → 'max_tokens'.
const MAX_TOKENS = 12_000

// Teto de tokens do lote de 2 variações (#423): 2 Receitas completas + thinking numa resposta. Fica
// ABAIXO de ~21.3k: acima disso o SDK exige streaming numa chamada não-streaming e lança antes de enviar.
const VARIANTS_MAX_TOKENS = 20_000

// Prazo da chamada de Geração (chamada + reparo; o SDK não tenta de novo depois do abort). Limita ESTA
// chamada, abaixo do `maxDuration = 60` das rotas: estourar vira `parse_failed` controlado em vez de a
// Vercel matar a função (504). Na conversa, o stream vem ANTES e não entra nesse prazo.
const GENERATION_DEADLINE_MS = 50_000

/** Sinal que aborta no abort do cliente HTTP OU no prazo da Geração — o que vier primeiro. */
function generationSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(GENERATION_DEADLINE_MS)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}

/**
 * Ajuste efetivo da Geração (e da conversa): o do admin (ADR-0034) ou o default da tarefa. `effort` só
 * vai para as famílias selecionáveis (Opus/Sonnet/Fable): uma linha legada com outro modelo (ex.: Haiku,
 * que dá 400 com `effort`) segue no default dele, mesmo quando a rota passa o ajuste default da tarefa.
 */
function generationSettings(input: { model: string; settings?: ModelSettings }): ModelSettings {
  const settings = input.settings ?? TASK_DEFAULT_SETTINGS.generation
  return selectableFamilyOf(input.model) ? settings : { ...settings, effort: null }
}

/** `thinking` + `output_config` (formato + esforço) de uma chamada structured com o ajuste dado. */
function structuredTuning<F>(format: F, settings: ModelSettings) {
  const { thinking, effort } = tuningParams(settings)
  return {
    ...(thinking ? { thinking } : {}),
    output_config: { format, ...(effort ? { effort } : {}) },
  }
}

/** `thinking` + `output_config.effort` de uma chamada de texto livre (stream da conversa). */
function streamTuning(settings: ModelSettings) {
  const { thinking, effort } = tuningParams(settings)
  return { ...(thinking ? { thinking } : {}), ...(effort ? { output_config: { effort } } : {}) }
}

/**
 * Loga o erro engolido por um método do seam (que devolve `parse_failed` ao chamador). Abort do
 * cliente não é falha — não loga. Resumo compacto, não o erro cru: o SDK não põe a API key no erro,
 * mas o objeto cru arrasta headers da resposta e, em erro de parse, o `JSON.parse` do V8 cita um
 * trecho da saída do modelo (que pode ecoar conteúdo do Usuário). Por isso: aspas removidas da
 * mensagem e teto de tamanho.
 */
function logSeamError(method: string, err: unknown, signal?: AbortSignal): void {
  if (signal?.aborted) return
  const e = (err ?? {}) as {
    name?: string
    status?: number
    type?: string | null
    requestID?: string | null
    message?: string
  }
  const message = String(e.message ?? err)
    .replace(/"[^"]*"/g, '"…"')
    .slice(0, 300)
  console.error(`[claude/${method}] falha na chamada (→ parse_failed):`, {
    name: e.name,
    status: e.status,
    type: e.type,
    requestID: e.requestID,
    message,
  })
}

/**
 * Loga um `parse_failed` que NÃO veio de exceção (saída nula após o reparo, cardinalidade errada).
 * Só metadados da resposta — nunca conteúdo.
 */
function logSeamParseFailed(
  method: string,
  reason: string,
  message: { id?: string; stop_reason?: string | null },
): void {
  console.error(`[claude/${method}] parse_failed (${reason}):`, {
    id: message.id,
    stopReason: message.stop_reason,
  })
}

/**
 * Loga os valores da saída que não casaram o vocabulário e caíram no fallback (campo null, restrição
 * descartada, `kind` inferido). A geração segue; o log diz quais aliases faltam. O valor cru é curto
 * por natureza (rótulo de enum, quantidade), mas vai com teto de tamanho e sem aspas/quebras, pelo
 * mesmo motivo de `logSeamError`: pode ecoar texto do Usuário.
 */
function logDescartes(method: string, descartes: readonly CampoDescartado[]): void {
  if (descartes.length === 0) return
  console.warn(`[claude/${method}] valores fora do vocabulário caíram no fallback:`, {
    descartes: descartes.slice(0, 20).map((d) => ({
      campo: d.campo,
      valor: d.valor.replace(/["\r\n]/g, ' ').slice(0, 40),
    })),
  })
}

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
      // Valores fora do vocabulário que o parse normalizou para o fallback (log, não falha).
      const descartes: CampoDescartado[] = []
      const schema = buildRecipeGenSchema(input.cozinhaSlugs ?? [], (d) => descartes.push(d))
      const params = {
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        messages: [{ role: 'user' as const, content: input.userPrompt }],
        // Esforço/thinking do admin (ADR-0034). SEM prefill, SEM temperature custom: os modelos 4.7+
        // os rejeitam (landmine §11). Thinking `default` ⇒ o parâmetro não vai e cada modelo roda no
        // seu default (Opus 5.5/Fable: adaptive, sempre ligado; Opus 4.8: desligado).
        ...structuredTuning(zodOutputFormat(schema), generationSettings(input)),
      }

      // O `signal` (opcional) propaga o abort do cliente HTTP ao SDK: se a requisição
      // já foi abortada, a chamada estoura e cai no catch (parse_failed) sem queimar quota.
      // Um prazo só p/ chamada + reparo (`generationSignal`).
      const signal = generationSignal(input.signal)
      let message = await client.messages.parse(params, { signal })

      // Branch por stop_reason (NÃO stop_details — esse é só metadado de categoria).
      if (message.stop_reason === 'refusal') return { kind: 'refusal' }
      // Uma resposta de saída estruturada TRUNCADA lança dentro de messages.parse e é
      // pega no catch como parse_failed; este branch só trata o sinal max_tokens
      // SEM truncamento do structured output.
      if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' }

      // Repair mínimo: se o parser não produziu saída, re-chama UMA vez com a mesma
      // entrada. Ainda null → parse_failed.
      if (message.parsed_output === null) {
        message = await client.messages.parse(params, { signal })
        if (message.stop_reason === 'refusal') return { kind: 'refusal' }
        if (message.stop_reason === 'max_tokens') return { kind: 'max_tokens' }
        if (message.parsed_output === null) {
          logSeamParseFailed('generateRecipe', 'saída nula após reparo', message)
          return { kind: 'parse_failed' }
        }
      }

      const parsed = message.parsed_output
      logDescartes('generateRecipe', descartes)
      // `receita` já é null para impossible (regra de app no schema flat); sem ternário.
      return {
        kind: 'object',
        recipe: parsed.receita,
        advisory: parsed.advisory,
        modelKind: parsed.kind,
        // #463: telemetria de custo da chamada (input/output tokens). A borda a passa ao persist, que
        // deriva o `cost_usd` snapshot. Só o branch 'object' persiste linha de generation ⇒ só ele carrega.
        usage: mapTextUsage(message.usage),
      }
    } catch (err) {
      // Qualquer erro de rede/SDK/validação → parse_failed. Nunca vaza stack pro cliente;
      // nunca vira Receita parcial. Loga no servidor: sem isso a causa (crédito, chave,
      // modelo recusado) fica invisível em produção.
      logSeamError('generateRecipe', err, input.signal)
      return { kind: 'parse_failed' }
    }
  }

  async generateRecipeVariants(input: GenerationInput): Promise<GenerationOutput[]> {
    // Espelha `generateRecipe` (messages.parse + zodOutputFormat + reparo de UMA tentativa), mas no
    // schema-LISTA (`buildRecipeGenListSchema`) e com o teto 2×. Caminho paralelo — não toca o single.
    const client = new Anthropic()

    try {
      const descartes: CampoDescartado[] = []
      const schema = buildRecipeGenListSchema(input.cozinhaSlugs ?? [], (d) => descartes.push(d))
      const params = {
        model: input.model,
        max_tokens: VARIANTS_MAX_TOKENS,
        system: input.systemPrompt,
        messages: [{ role: 'user' as const, content: input.userPrompt }],
        ...structuredTuning(zodOutputFormat(schema), generationSettings(input)),
        // SEM temperature/top_p/seed: os modelos 4.7+ os rejeitam (400). A variedade vem do PROMPT
        // (o fragmento de eixo `variacaoDivergente` já embutido no systemPrompt).
      }

      const signal = generationSignal(input.signal)
      let message = await client.messages.parse(params, { signal })
      if (message.stop_reason === 'refusal') return [{ kind: 'refusal' }]
      // Saída structured TRUNCADA lança dentro de messages.parse (→ catch, parse_failed do lote); este
      // branch só trata o sinal max_tokens SEM truncamento do structured.
      if (message.stop_reason === 'max_tokens') return [{ kind: 'max_tokens' }]

      if (message.parsed_output === null) {
        message = await client.messages.parse(params, { signal })
        if (message.stop_reason === 'refusal') return [{ kind: 'refusal' }]
        if (message.stop_reason === 'max_tokens') return [{ kind: 'max_tokens' }]
        if (message.parsed_output === null) {
          logSeamParseFailed('generateRecipeVariants', 'saída nula após reparo', message)
          return [{ kind: 'parse_failed' }]
        }
      }

      const variacoes = message.parsed_output.variacoes
      logDescartes('generateRecipeVariants', descartes)
      // EXATO-2: o schema-array é PLANO (sem bound — evita `$defs`, ver recipe-gen-schema.ts); a
      // cardinalidade é exigida AQUI. ≠2 ⇒ parse_failed do LOTE (erro de geração; NÃO degrada — ADR-0029).
      if (variacoes.length !== 2) {
        logSeamParseFailed('generateRecipeVariants', `cardinalidade ${variacoes.length} ≠ 2`, message)
        return [{ kind: 'parse_failed' }]
      }

      // #463: o `message.usage` cobre o LOTE INTEIRO (uma chamada structured produz as 2 receitas).
      // Anexamos a telemetria SÓ à 1ª variação — anexar às 2 dobraria o custo na soma do ledger. A 2ª
      // fica sem `usage` ⇒ custo NULL honesto (a linha existe, o custo do lote não é contado 2×).
      const batchUsage = mapTextUsage(message.usage)
      return variacoes.map((v, i) => ({
        kind: 'object' as const,
        recipe: v.receita,
        advisory: v.advisory,
        modelKind: v.kind,
        variacao: v.variacao,
        usage: i === 0 ? batchUsage : undefined,
      }))
    } catch (err) {
      // Truncamento no meio da 2ª receita OU qualquer erro de rede/SDK/validação → parse_failed do lote.
      logSeamError('generateRecipeVariants', err, input.signal)
      return [{ kind: 'parse_failed' }]
    }
  }

  async extractIngredients(input: GenerationInput): Promise<ExtractionOutput> {
    // #463: a Extração NÃO gera linha em `generation` (só organiza uma lista de ingredientes, ADR-0009),
    // então não há onde carimbar `cost_usd` — o ledger de texto cobre as gerações de Receita. O custo
    // da Extração (modelo da sua tarefa, ADR-0034) fica fora do ledger de propósito (não distorce o
    // custo da Geração). O `message.usage` aqui é descartado conscientemente (não por esquecimento).
    // Espelha generateRecipe (mesma disciplina ADR-0009: messages.parse + zodOutputFormat +
    // reparo de UMA tentativa), mas no IngredientExtractionSchema e com o teto de tokens da
    // Extração. Lazy: lê ANTHROPIC_API_KEY só na chamada — NUNCA em teste (o teste injeta o
    // FakeClaudeClient). QUALQUER throw/null após o reparo → parse_failed (nunca vaza stack
    // nem item parcial). NÃO ramifica por stop_reason em refusal/max_tokens: para a Extração,
    // qualquer não-sucesso é simplesmente parse_failed (a rota mapeia para 502).
    const client = new Anthropic()
    const extractionSettings = input.settings ?? TASK_DEFAULT_SETTINGS.extraction

    try {
      const params = {
        model: input.model,
        // Ajuste do admin (ADR-0034); sem ele, o default da tarefa (thinking desligado). Com thinking
        // possivelmente ligado, o teto ganha folga (os tokens de raciocínio contam no max_tokens).
        max_tokens: maxTokensFor(EXTRACTION_MAX_TOKENS, extractionSettings),
        system: input.systemPrompt,
        messages: [{ role: 'user' as const, content: input.userPrompt }],
        ...structuredTuning(zodOutputFormat(IngredientExtractionSchema), extractionSettings),
      }

      // Mesmo prazo da Geração: com o modelo/thinking do admin a chamada pode demorar, e a rota tem
      // `maxDuration = 60` — melhor `parse_failed` limpo que a função morta no meio.
      const signal = generationSignal(input.signal)
      let message = await client.messages.parse(params, { signal })

      // Reparo mínimo: se o parser não produziu saída, re-chama UMA vez. Ainda null →
      // parse_failed.
      if (message.parsed_output === null) {
        message = await client.messages.parse(params, { signal })
        if (message.parsed_output === null) {
          logSeamParseFailed('extractIngredients', 'saída nula após reparo', message)
          return { kind: 'parse_failed' }
        }
      }

      return { kind: 'ok', items: message.parsed_output.items }
    } catch (err) {
      logSeamError('extractIngredients', err, input.signal)
      return { kind: 'parse_failed' }
    }
  }

  async *streamConversation(input: ConversationStreamInput): AsyncIterable<string> {
    // #463: o STREAM da conversa rende só TEXTO (sem canal de retorno de usage nesta interface). O custo
    // desse turno de chat NÃO tem linha própria em `generation` — a linha da conversa nasce da DESTILAÇÃO
    // (2ª chamada, `generateRecipe` verbatim em stream/route.ts), que JÁ carimba o `cost_usd` da destilação.
    // Medir o texto do stream exigiria uma coluna/tabela nova (fora do escopo do ledger da geração). Gap
    // conhecido e consciente (não esquecimento).
    // Lazy: lê ANTHROPIC_API_KEY do ambiente só na chamada — NUNCA em teste.
    const client = new Anthropic()

    const stream = client.messages.stream(
      {
        model: input.model,
        max_tokens: MAX_TOKENS,
        system: input.systemPrompt,
        messages: input.transcript.map((m) => ({ role: m.role, content: m.content })),
        // Thinking/esforço do admin (ADR-0034, tarefa Geração); só rendemos TEXTO (thinking_delta é
        // ignorado abaixo).
        ...streamTuning(generationSettings(input)),
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
  // `cannedVariants` (#423) é o QUINTO arg OPCIONAL — vem DEPOIS dos quatro para que TODOS os call
  // sites existentes compilem sem mudança. `generateRecipeVariants` o devolve (ignora axes/cozinhaSlugs,
  // como os demais), ou estoura se ausente.
  constructor(
    private readonly reply: (text: string) => string = (text) => text,
    private readonly canned?: GenerationOutput,
    private readonly cannedTokens?: string[],
    private readonly cannedExtraction?: ExtractionOutput,
    private readonly cannedVariants?: GenerationOutput[],
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

  async generateRecipeVariants(): Promise<GenerationOutput[]> {
    if (!this.cannedVariants) {
      throw new Error(
        'FakeClaudeClient: nenhum lote de variações enlatado (passe-o como 5º arg do construtor).',
      )
    }
    return this.cannedVariants
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
