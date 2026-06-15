/**
 * Vocabulário culinário — kernel compartilhado (fonte ÚNICA de verdade).
 *
 * Mesma taxonomia usada pela Busca (como FILTRO sobre o existente) e pela criação
 * estruturada (como CONSTRAINT de geração) — semântica oposta, um só vocabulário
 * (CONTEXT.md → "Vocabulário culinário").
 *
 * Forma das dimensões (honra ADR-0009: "faixas numéricas (porções, dificuldade)
 * validadas no app, porque o JSON Schema não suporta min/max"):
 *  - Cozinha e Restrição alimentar → ENUMS (conjuntos controlados, extensíveis).
 *  - Dificuldade e Porções        → FAIXAS NUMÉRICAS validadas no app.
 *
 * Categoria (curso) e Tag (rótulo livre) NÃO pertencem a este kernel bidirecional:
 * são vocabulários separados (Briefing de geração não tem Categoria nem Tag).
 *
 * Escopo do kernel: só os conjuntos/faixas + validadores PUROS de pertencimento e
 * de faixa. Nada de defaults, ordenação, rótulos i18n ou regras de compatibilidade
 * ("qual cozinha combina com qual") — isso pertence aos consumidores (Busca/Briefing).
 */

// ── Cozinha (cuisine): tradição gastronômica, vocabulário controlado ───────────
export const COZINHAS = [
  'italiana',
  'japonesa',
  'brasileira',
  'baiana',
  'mineira',
  'mexicana',
  'chinesa',
  'indiana',
  'tailandesa',
  'francesa',
  'arabe',
  'portuguesa',
  'mediterranea',
  'peruana',
] as const
export type Cozinha = (typeof COZINHAS)[number]

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

/** O kernel bidirecional: o que a Busca filtra e a criação estruturada constrange. */
export const vocabularioCulinario = {
  cozinhas: COZINHAS,
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

export function isCozinha(value: string): value is Cozinha {
  return (COZINHAS as readonly string[]).includes(value)
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
