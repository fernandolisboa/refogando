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

import Anthropic from '@anthropic-ai/sdk'
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
}

export type TranslateOutput = TranslatableFields

export interface Translator {
  translate(input: TranslateInput): Promise<TranslateOutput>
}

// Modelo DEDICADO da tradução (#426, ADR-0030 dec.2). Env-overridable — sobe p/ 'claude-opus-4-8'
// sem deploy. Sonnet 5 equilibra qualidade/custo p/ uma tarefa faithful cacheada (uma vez por
// receita×locale). Lido no load do módulo (como EXTRACTION_MODEL); o caminho real não é testado.
export const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL ?? 'claude-sonnet-5'

/**
 * Implementação real (#426): traduz via Claude com structured output. Espelha a disciplina de
 * `extractIngredients` (messages.parse + zodOutputFormat + 1 reparo), MAS com contrato de erro
 * INVERSO: qualquer não-sucesso OU infidelidade LANÇA (não devolve parse_failed) — `ensureTranslation`
 * degrada por try/catch sem escrever (AC4).
 */
export class RealTranslator implements Translator {
  async translate(input: TranslateInput): Promise<TranslateOutput> {
    // Lazy: o SDK lê ANTHROPIC_API_KEY do ambiente só na chamada — NUNCA em teste (injeta-se
    // FakeTranslator via setTranslator). Mesma key da Geração; nenhuma env nova.
    const client = new Anthropic()

    const { systemPrompt, userPrompt } = buildTranslationPrompt({
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      fields: input.fields,
    })

    const params = {
      model: TRANSLATION_MODEL,
      max_tokens: TRANSLATION_MAX_TOKENS,
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: userPrompt }],
      output_config: { format: zodOutputFormat(TranslationSchema) },
      // `thinking: disabled` EXPLÍCITO (ADR-0030 dec.1): Sonnet 5 roda adaptive-thinking por
      // OMISSÃO — sem isso os tokens de raciocínio dividem o teto com o JSON e a saída trunca
      // (→ throw → degrada). Sem temperature/top_p/seed: Opus/Sonnet os rejeitam (400).
      thinking: { type: 'disabled' as const },
    }

    let message = await client.messages.parse(params)
    if (message.stop_reason === 'refusal') throw new Error('tradução recusada pelo modelo (refusal)')
    if (message.stop_reason === 'max_tokens') throw new Error('tradução truncada (max_tokens)')

    // Reparo mínimo: parser sem saída ⇒ re-chama UMA vez. Ainda null ⇒ lança.
    if (message.parsed_output === null) {
      message = await client.messages.parse(params)
      if (message.stop_reason === 'refusal') throw new Error('tradução recusada pelo modelo (refusal)')
      if (message.stop_reason === 'max_tokens') throw new Error('tradução truncada (max_tokens)')
      if (message.parsed_output === null) throw new Error('tradução sem saída estruturada')
    }

    const parsed = message.parsed_output
    const result: TranslateOutput = {
      titulo: parsed.titulo,
      descricao: parsed.descricao,
      passos: parsed.passos,
      notas: parsed.notas,
    }

    // Fidelidade pós-parse: um parse bem-formado porém LOSSY (passos faltando, descrição sumida)
    // não é falha p/ o schema — LANÇA aqui ⇒ degrada honesto em vez de persistir MT ruim.
    assertFaithfulTranslation(input.fields, result)

    return result
  }
}

/**
 * Dublê determinístico: devolve o canned se fornecido, senão ecoa os campos de origem
 * (tradução = identidade). Para testes que só precisam de UMA linha do 2º locale criada.
 */
export class FakeTranslator implements Translator {
  constructor(private readonly canned?: TranslateOutput) {}

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    return this.canned ?? input.fields
  }
}

/** Dublê que SEMPRE falha — exercita a degradação graciosa (AC4: cai pro original, sem erro). */
export class ThrowingTranslator implements Translator {
  async translate(): Promise<TranslateOutput> {
    throw new Error('tradução indisponível (dublê de degradação)')
  }
}
