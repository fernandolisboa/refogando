/**
 * Seam ÚNICO e mockável para tradução automática de Receita (issue #23).
 *
 * A tradução real (cliente LLM, prompt, custo) é PR à parte — aqui só fixamos a
 * interface mockável, espelhando o seam de embedding (`embedder.ts`): interface +
 * implementação Real-que-lança + dublê Fake + dublê Throwing. O serviço
 * `ensureTranslation` (issue #23) consome este seam via DI (`getTranslator()`).
 */

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

/** Implementação real — stub até a tradução real (cliente LLM) ser plugada numa PR à parte. */
export class RealTranslator implements Translator {
  async translate(): Promise<TranslateOutput> {
    throw new Error('RealTranslator ainda não implementado — tradução real é PR à parte')
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
