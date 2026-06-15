import type { GenerationOutput } from '@/domain/generation'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'

/**
 * Builders de `GenerationOutput` enlatado (issue #8). Cada builder devolve UMA classe
 * da fronteira crua que o `FakeClaudeClient(undefined, canned)` injeta no seam — o
 * teste escolhe a classe e a rota a classifica via `classify` (sem rede, sem API real).
 *
 * `quantidade` é STRING|null (numeric(10,3) trafega como '2.500'), nunca number.
 * porcoes/dificuldade default em faixa válida (PORCOES {1,50} / DIFICULDADE {1,5});
 * sobrescreva para forçar fora-de-faixa → `invalid` no app (não clampa).
 */

/** Receita "miolo" válida por default. Sobrescreva campos pontuais via `overrides`. */
export function makeReceita(overrides: Partial<ReceitaGenT> = {}): ReceitaGenT {
  return {
    titulo: 'Arroz de forno',
    descricao: 'Arroz assado com queijo.',
    passos: ['Misture tudo.', 'Leve ao forno.'],
    notas: 'Sirva quente.',
    originalLocale: 'pt-BR',
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: ['sem_gluten'],
    porcoes: 4,
    dificuldade: 2,
    ingredientes: [
      { rawText: '2 xícaras de arroz cozido', quantidade: '2.000', unidade: 'xicara' },
      { rawText: 'sal a gosto', quantidade: null, unidade: 'a_gosto' },
    ],
    ...overrides,
  }
}

/** object + modelKind success (recipe presente). Faixas válidas por default. */
export function cannedSuccess(
  receita: Partial<ReceitaGenT> = {},
  advisory: string | null = 'Dica: use arroz do dia anterior.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'success', recipe: makeReceita(receita), advisory }
}

/** object + modelKind degraded (recipe presente). */
export function cannedDegraded(
  receita: Partial<ReceitaGenT> = {},
  advisory: string | null = 'Faltou um ingrediente; ajustei a receita.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'degraded', recipe: makeReceita(receita), advisory }
}

/** object + modelKind playful (recipe presente; salva só em privado). */
export function cannedPlayful(
  receita: Partial<ReceitaGenT> = {},
  advisory: string | null = 'Receita só pela diversão — não tente em casa.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'playful', recipe: makeReceita(receita), advisory }
}

/** object + modelKind impossible (recipe null por contrato; só advisory). */
export function cannedImpossible(
  advisory: string | null = 'Não dá pra fazer bolo só com água.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'impossible', recipe: null, advisory }
}

export function cannedRefusal(): GenerationOutput {
  return { kind: 'refusal' }
}

export function cannedMaxTokens(): GenerationOutput {
  return { kind: 'max_tokens' }
}

export function cannedParseFailed(): GenerationOutput {
  return { kind: 'parse_failed' }
}
