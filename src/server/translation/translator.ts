/**
 * Seam ÚNICO e mockável para tradução automática de Receita (issue #23; tradução real #426).
 *
 * A interface espelha o seam de embedding (`embedder.ts`): interface + implementação Real + dublê
 * Fake + dublê Throwing. O serviço `ensureTranslation` (issue #23) consome este seam via DI
 * (`getTranslator()`). O `RealTranslator` é o cliente LLM real (Anthropic, ADR-0030): fala com a
 * fronteira DIRETO (como `RealEmbedder` com o Gemini), structured output via `TranslationSchema`, e
 * — INVARIANTE do seam — LANÇA em qualquer falha OU infidelidade, para `ensureTranslation` degradar
 * pro original sem escrever (AC4). Não é unit-testado (convenção Real*, como `RealEmbedder`); a
 * lógica testável (prompt, schema, fidelidade) vive no domínio (`translation-prompt.ts`).
 */

import { TASK_DEFAULT_SETTINGS, maxTokensFor, tuningParams, type ModelSettings } from '@/domain/ai-task-config'
import Anthropic from '@anthropic-ai/sdk'
import { TASK_FALLBACK_MODELS } from '@/server/app-config'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  TranslationSchema,
  TRANSLATION_MAX_TOKENS,
  buildTranslationPrompt,
  assertFaithfulTranslation,
} from '@/domain/translation-prompt'

/** Campos por-locale (traduzíveis) — espelha TRANSLATABLE_FIELDS de `stale-rule.ts`. */
export type TranslatableFields = {
  titulo: string
  descricao?: string | null
  passos?: string[] | null
  notas?: string | null
}

export type TranslateInput = {
  sourceLocale: string
  targetLocale: string
  fields: TranslatableFields
  /**
   * Nomes de ingrediente de ORIGEM por `ordem` (#426, Fatia 2) — o `nome` é o `raw_text`. OPCIONAL
   * (back-compat: os call sites/dublês existentes seguem válidos). A MEDIDA nunca entra (Direção B).
   */
  ingredientes?: { ordem: number; nome: string }[]
  /** Contexto p/ desambiguar termos (#426) — a cozinha do prato. OPCIONAL. */
  contexto?: { cozinha?: string | null }
}

export type TranslateOutput = TranslatableFields & {
  /** Nomes de ingrediente TRADUZIDOS por `ordem` (#426, Fatia 2). Ausente quando não pedido. */
  ingredientes?: { ordem: number; nome: string }[]
}

export interface Translator {
  translate(input: TranslateInput): Promise<TranslateOutput>
}

/**
 * Modelo + ajuste da tradução, lidos A CADA chamada (ADR-0034: escolhidos no admin, tarefa
 * `translation`). Default: Sonnet 5 com thinking desligado (ADR-0030 dec.1/2), ou a env var legada
 * `TRANSLATION_MODEL`. `deps.ts` injeta o leitor de `app_config`.
 */
export type TranslationTaskLoader = () => Promise<{ model: string; settings: ModelSettings }>

const TRANSLATION_DEADLINE_MS = 50_000

const DEFAULT_TRANSLATION_TASK: TranslationTaskLoader = async () => ({
  model: TASK_FALLBACK_MODELS.translation,
  settings: TASK_DEFAULT_SETTINGS.translation,
})

/**
 * O modelo RESPONDEU, mas a saída é inutilizável para ESTA Receita: recusa, truncamento
 * (`max_tokens`), JSON/schema inválido (erro de parse do helper `zodOutputFormat` do SDK), sem saída
 * estruturada, ou infidelidade (`assertFaithfulTranslation`). É a única classe de falha que conta no
 * circuit-breaker da re-tradução (#520) — tende a se repetir na mesma fonte. Continua sendo um
 * `Error`, então `ensureTranslation` degrada igual (try/catch genérico).
 */
export class UnusableTranslationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'UnusableTranslationError'
  }
}

/**
 * `messages.parse` com a fronteira de erro classificada: o SDK roda o `parse` do `zodOutputFormat`
 * DENTRO da chamada e, em JSON cortado/schema violado, lança um `AnthropicError` PURO (não
 * `APIError`) com a mensagem "Failed to parse structured output…" (helpers/zod.js, lib/parser.js) —
 * isso é saída ruim da linha, não queda do serviço. Casa pela MENSAGEM de propósito: o SDK também
 * lança `AnthropicError` puro para credencial/config (key ausente, token de identidade vazio,
 * "Streaming is required"), que é infraestrutura e segue propagando como está.
 */
const STRUCTURED_OUTPUT_PARSE_ERROR_PREFIX = 'Failed to parse structured output'

async function parseTranslation<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (
      err instanceof Anthropic.AnthropicError &&
      !(err instanceof Anthropic.APIError) &&
      err.message.startsWith(STRUCTURED_OUTPUT_PARSE_ERROR_PREFIX)
    ) {
      throw new UnusableTranslationError(`tradução com saída estruturada inválida: ${err.message}`, { cause: err })
    }
    throw err
  }
}

/** Recusa ou truncamento ⇒ a saída não serve (falha DA LINHA). */
function assertUsableStop(stopReason: string | null): void {
  if (stopReason === 'refusal') throw new UnusableTranslationError('tradução recusada pelo modelo (refusal)')
  if (stopReason === 'max_tokens') throw new UnusableTranslationError('tradução truncada (max_tokens)')
}

/**
 * Implementação real (#426): traduz via Claude com structured output. Espelha a disciplina de
 * `extractIngredients` (messages.parse + zodOutputFormat + 1 reparo), MAS com contrato de erro
 * INVERSO: qualquer não-sucesso OU infidelidade LANÇA (não devolve parse_failed) — `ensureTranslation`
 * degrada por try/catch sem escrever (AC4).
 */
export class RealTranslator implements Translator {
  constructor(private readonly loadTask: TranslationTaskLoader = DEFAULT_TRANSLATION_TASK) {}

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    // Lazy: o SDK lê ANTHROPIC_API_KEY do ambiente só na chamada — NUNCA em teste (injeta-se
    // FakeTranslator via setTranslator). Mesma key da Geração; nenhuma env nova.
    const client = new Anthropic()

    const { systemPrompt, userPrompt } = buildTranslationPrompt({
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      fields: input.fields,
      ingredientes: input.ingredientes,
      contexto: input.contexto,
    })

    const { model, settings } = await this.loadTask()
    const { thinking, effort } = tuningParams(settings)
    const params = {
      model,
      // Com thinking possivelmente ligado, o teto ganha folga (os tokens de raciocínio contam nele).
      max_tokens: maxTokensFor(TRANSLATION_MAX_TOKENS, settings),
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: userPrompt }],
      output_config: { format: zodOutputFormat(TranslationSchema), ...(effort ? { effort } : {}) },
      // Thinking do admin (ADR-0034); o default da tarefa é `disabled` EXPLÍCITO (ADR-0030 dec.1):
      // Sonnet 5 roda adaptive-thinking por OMISSÃO e os tokens de raciocínio dividiriam o teto com o
      // JSON. Sem temperature/top_p/seed: Opus/Sonnet os rejeitam (400).
      ...(thinking ? { thinking } : {}),
    }

    // Prazo da chamada + reparo, abaixo do `maxDuration = 60` da rota: com o modelo/thinking do admin
    // (ADR-0034) a tradução pode demorar; estourar vira erro limpo (a Receita cai no original) em vez de 504.
    const signal = AbortSignal.timeout(TRANSLATION_DEADLINE_MS)
    let message = await parseTranslation(() => client.messages.parse(params, { signal }))
    assertUsableStop(message.stop_reason)

    // Reparo mínimo: parser sem saída ⇒ re-chama UMA vez. Ainda null ⇒ lança.
    if (message.parsed_output === null) {
      message = await parseTranslation(() => client.messages.parse(params, { signal }))
      assertUsableStop(message.stop_reason)
      if (message.parsed_output === null) throw new UnusableTranslationError('tradução sem saída estruturada')
    }

    const parsed = message.parsed_output
    const result: TranslateOutput = {
      titulo: parsed.titulo,
      descricao: parsed.descricao,
      passos: parsed.passos,
      notas: parsed.notas,
      // Só devolve nomes traduzidos quando foram PEDIDOS (Fatia 2) — senão o schema ainda exige o
      // campo na saída (`[]`), mas o contrato do seam o omite (back-compat com o consumidor dos 4 campos).
      ...(input.ingredientes ? { ingredientes: parsed.ingredientes } : {}),
    }

    // Fidelidade pós-parse: um parse bem-formado porém LOSSY (passos faltando, ingrediente omitido,
    // conjunto de `ordem` diferente) não é falha p/ o schema — LANÇA aqui ⇒ degrada honesto (AC4)
    // em vez de persistir MT ruim.
    try {
      assertFaithfulTranslation(input.fields, result, input.ingredientes, parsed.ingredientes)
    } catch (err) {
      throw new UnusableTranslationError(err instanceof Error ? err.message : String(err), { cause: err })
    }

    return result
  }
}

/**
 * A falha é DA LINHA (não da infraestrutura)? Alimenta o circuit-breaker da re-tradução (#520):
 * allowlist — só `UnusableTranslationError` (o modelo respondeu, a saída não serve) conta para a
 * quarentena. Todo o resto — `APIError` (429/5xx/529, conexão/timeout, 400/401/403/404 de config),
 * key ausente, erro desconhecido — é tratado como infraestrutura: contá-lo quarentenaria o lote
 * inteiro numa queda ou num deploy mal configurado. Na dúvida, a linha só degrada (comportamento
 * anterior ao #520), nunca vai pra quarentena por engano.
 */
export function isRowSpecificTranslationFailure(err: unknown): boolean {
  return err instanceof UnusableTranslationError
}

/**
 * Dublê determinístico: devolve o canned se fornecido, senão ecoa os campos de origem
 * (tradução = identidade). Para testes que só precisam de UMA linha do 2º locale criada.
 */
export class FakeTranslator implements Translator {
  constructor(private readonly canned?: TranslateOutput) {}

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    if (this.canned) return this.canned
    // Identidade: ecoa os 4 campos + os nomes de ingrediente (quando pedidos, #426 Fatia 2). Sem
    // ingredientes o resultado é `input.fields` byte-a-byte (mantém os testes de 4-campos verdes).
    return input.ingredientes
      ? { ...input.fields, ingredientes: input.ingredientes }
      : input.fields
  }
}

/** Dublê que SEMPRE falha — exercita a degradação graciosa (AC4: cai pro original, sem erro). */
export class ThrowingTranslator implements Translator {
  async translate(): Promise<TranslateOutput> {
    throw new Error('tradução indisponível (dublê de degradação)')
  }
}
