/**
 * Vocabulário culinário — kernel compartilhado (fonte ÚNICA de verdade).
 *
 * Mesma taxonomia usada pela Busca (como FILTRO sobre o existente) e pela criação
 * estruturada (como CONSTRAINT de geração) — semântica oposta, um só vocabulário
 * (CONTEXT.md → "Vocabulário culinário").
 *
 * Forma das dimensões (honra ADR-0009: "faixas numéricas (porções, dificuldade)
 * validadas no app, porque o JSON Schema não suporta min/max"):
 *  - Cozinha → DATA-DRIVEN (#318, ADR-0025): saiu do enum estático e virou a tabela
 *    `vocabulary_term`. `type Cozinha = string`; o pertencimento é checado contra o
 *    CONJUNTO ATIVO injetado (`isActiveCozinha`), nunca contra um `as const`.
 *  - Restrição alimentar → ENUM (conjunto controlado, extensível).
 *  - Dificuldade e Porções → FAIXAS NUMÉRICAS validadas no app.
 *
 * Categoria (curso) e Tag (rótulo livre) NÃO pertencem a este kernel bidirecional:
 * são vocabulários separados (Briefing de geração não tem Categoria nem Tag).
 *
 * Escopo do kernel: só os conjuntos/faixas + validadores PUROS de pertencimento e
 * de faixa. Nada de defaults, ordenação, rótulos i18n ou regras de compatibilidade
 * ("qual cozinha combina com qual") — isso pertence aos consumidores (Busca/Briefing).
 */

// ── Cozinha (cuisine): tradição gastronômica, DATA-DRIVEN (#318, ADR-0025) ─────
// Saiu do enum estático `COZINHAS` (e do pgEnum `cozinha`) e virou a tabela `vocabulary_term`:
// QUAIS cozinhas existem é DADO curável. O tipo é `string` (qualquer slug); o pertencimento ao
// conjunto ATIVO é checado por `isActiveCozinha(value, activeCozinhas)` na borda. A seed das 14
// antigas + 'americana' vive em `COZINHA_SEED` (@/domain/vocabulary-term), fonte da migração.
export type Cozinha = string

// ── Restrição alimentar: contrato de adequação (dieta/alergia/intolerância) ─────
export const RESTRICOES = [
  'sem_gluten',
  'sem_lactose',
  'vegano',
  'vegetariano',
  'sem_acucar',
  'low_carb',
  'sem_oleaginosas',
  'sem_frutos_do_mar',
] as const
export type Restricao = (typeof RESTRICOES)[number]

// ── Faixas numéricas (validadas no app — ADR-0009) ─────────────────────────────
export type FaixaNumerica = { readonly min: number; readonly max: number }

export const DIFICULDADE: FaixaNumerica = { min: 1, max: 5 }
export const PORCOES: FaixaNumerica = { min: 1, max: 50 }
// Tempo de preparo (#261, ADR-0023): minutos. Faixa validada na borda (positividade +
// teto sanitário de 7 dias = 10080 min, cobre fermentação/maturação longa, barra absurdo).
// Mesma faixa serve ativo e total; o CHECK do banco (ativo ≤ total) é o invariante de
// consistência entre as facetas. FORA do kernel bidirecional: tempo é output-only da IA,
// não é filtro de Busca nem constraint de Briefing.
export const TEMPO_MIN: FaixaNumerica = { min: 1, max: 10080 }

/**
 * O kernel bidirecional: o que a Busca filtra e a criação estruturada constrange. Cozinha
 * NÃO aparece mais aqui (#318): virou DATA-DRIVEN (tabela `vocabulary_term`), resolvida na
 * borda, não um array estático do kernel. Restrição segue enum; dificuldade/porções, faixas.
 */
export const vocabularioCulinario = {
  restricoes: RESTRICOES,
  dificuldade: DIFICULDADE,
  porcoes: PORCOES,
} as const

// ── Vocabulários SEPARADOS (fora do kernel bidirecional) ───────────────────────

/** Categoria (curso): papel na refeição. Ortogonal a Cozinha. Não entra no Briefing. */
export const CATEGORIAS = [
  'entrada',
  'prato_principal',
  'sobremesa',
  'bebida',
  'molho',
  'acompanhamento',
  'lanche',
  'cafe_da_manha',
] as const
export type Categoria = (typeof CATEGORIAS)[number]

/**
 * Tag: rótulo descritivo livre e multivalorado (N:M com Receita). NÃO tem lista
 * controlada — é texto livre normalizado. Modelado como string; a tabela/junção
 * nasce na #3. Aqui só fixamos o tipo para o glossário sobreviver no código.
 */
export type Tag = string

/**
 * Unidade de medida do ingrediente: conjunto controlado (enum-do-kernel, ADR-0012).
 * O texto verbatim da cauda longa vive em `recipe_ingredient.raw_text`; este enum
 * cobre as unidades canônicas. `a_gosto`/`q_b` são as não-mensuráveis usuais.
 */
export const UNIDADES = [
  'g',
  'kg',
  'ml',
  'l',
  'colher_de_sopa',
  'colher_de_cha',
  'xicara',
  'unidade',
  'dente',
  'fatia',
  'pitada',
  'a_gosto',
  'q_b',
] as const
export type Unidade = (typeof UNIDADES)[number]

// ── Validadores PUROS ──────────────────────────────────────────────────────────

/**
 * Validador de cozinha DATA-DRIVEN (#316/#318, ADR-0025 Decisão 4): pertencimento ao CONJUNTO
 * ATIVO injetado. O conjunto vem da tabela `vocabulary_term` (via `loadActiveCozinhaSlugs` na
 * escrita ou `loadVocabulary` cacheado na leitura) — quem resolve o conjunto é a BORDA; o
 * validador só checa pertencimento, permanecendo PURO/SÍNCRONO. Desde a virada #318 NÃO há mais
 * `isCozinha` ancorado no enum: `recipe.cozinha`/`briefing.cozinha` são `text` com FK p/
 * `vocabulary_term.slug`, então a única regra de pertencimento é "está no conjunto ativo?".
 */
export function isActiveCozinha(value: string, activeCozinhas: ReadonlySet<string>): boolean {
  return activeCozinhas.has(value)
}

export function isRestricao(value: string): value is Restricao {
  return (RESTRICOES as readonly string[]).includes(value)
}

export function isCategoria(value: string): value is Categoria {
  return (CATEGORIAS as readonly string[]).includes(value)
}

export function isUnidade(value: string): value is Unidade {
  return (UNIDADES as readonly string[]).includes(value)
}

function naFaixa(value: number, faixa: FaixaNumerica): boolean {
  return Number.isInteger(value) && value >= faixa.min && value <= faixa.max
}

export function isDificuldadeValida(value: number): boolean {
  return naFaixa(value, DIFICULDADE)
}

export function isPorcoesValidas(value: number): boolean {
  return naFaixa(value, PORCOES)
}

/**
 * Formato de `quantidade` (`recipe_ingredient.quantidade`, `numeric(10,3)`, trafega como string): '-'
 * opcional, até 7 inteiros, '.' + 1-3 fracionários. Fonte única do formato (schema de geração,
 * `classify`, formulário). Domínios mais estritos (ex.: item de compra, nunca negativo) têm o seu.
 */
export const QUANTIDADE_RE = /^-?\d{1,7}(\.\d{1,3})?$/

export function isTempoValido(value: number): boolean {
  return naFaixa(value, TEMPO_MIN)
}
