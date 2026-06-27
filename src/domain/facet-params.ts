/**
 * Parse/validação PURA dos params de faceta na borda da Busca (#10). Sem DB, espelhando
 * `search-terms.ts`. Recebe os valores crus de `URLSearchParams` e devolve uma
 * `EffectiveFacets` validada e DEGRADADA: valor inválido ⇒ ignora aquele valor, NUNCA
 * 400/500 (política "nunca tela quebrada"). Validar na borda é OBRIGATÓRIO porque bindar
 * string crua numa coluna enum dispara `22P02`→500 — o loader só recebe literais válidos.
 *
 * Reusa os validadores do Vocabulário (`isCategoria`/`isRestricao`/`isDificuldadeValida`/
 * `isPorcoesValidas`). Cozinha é DATA-DRIVEN (#316): o conjunto ATIVO chega injetado (param
 * `activeCozinhas`), resolvido pela borda da tabela `vocabulary_term` — o parse só checa
 * pertencimento, seguindo PURO. Tags normalizadas pelo MESMO fold de #9 (`foldIntent` de
 * `culinary-profile.ts`) para casar o lado-tabela folded no SQL.
 */

import {
  isCategoria,
  isRestricao,
  isDificuldadeValida,
  isPorcoesValidas,
  type Cozinha,
  type Categoria,
  type Restricao,
} from '@/domain/vocabulary'
import { foldIntent } from '@/domain/culinary-profile'
import { stripControlChars } from '@/domain/search-terms'

export type FaixaFacet = { min?: number; max?: number }

export type EffectiveFacets = {
  cozinhas: Cozinha[] // OR dentro do eixo
  categorias: Categoria[] // OR dentro do eixo
  tags: string[] // OR dentro do eixo (match por tag.nome normalizado)
  restricoes: Restricao[] // AND-contém-todas via @> (GIN)
  dificuldade?: FaixaFacet // faixa min/max
  porcoes?: FaixaFacet // faixa min/max
}

/** Vazio canônico — nenhum eixo presente. */
export const EMPTY_FACETS: EffectiveFacets = {
  cozinhas: [],
  categorias: [],
  tags: [],
  restricoes: [],
}

/** Cap de valores por eixo (espelha MAX_TERMS=16 de search-terms.ts; anti-fan-out). */
export const MAX_FACET_VALUES = 16

/** true sse NENHUM eixo está presente (controla o early-return neutro + faceta-only). */
export function isFacetsEmpty(f: EffectiveFacets): boolean {
  return (
    f.cozinhas.length === 0 &&
    f.categorias.length === 0 &&
    f.tags.length === 0 &&
    f.restricoes.length === 0 &&
    f.dificuldade === undefined &&
    f.porcoes === undefined
  )
}

/**
 * Fatia CSV → trim → dropa vazios → dedup. Puro. NÃO capa: o cap pertence a cada caller,
 * DEPOIS do filtro de validade (espelha `parseSearchTerms` de search-terms.ts:34-37 —
 * dedup/validade ANTES do cap pra que valores DISTINTOS-E-VÁLIDOS preencham o orçamento).
 * Capar aqui descartaria valores CRUS antes da checagem de validade: input com N>cap
 * lixos seguido de um válido devolveria `[]` em vez do válido (contradiz o docstring do
 * módulo: "valor inválido ⇒ ignora aquele valor").
 */
function csvValues(raw: string | null): string[] {
  if (raw === null) return []
  return [
    ...new Set(
      raw
        .split(',')
        .map((v) => stripControlChars(v).trim())
        .filter((v) => v.length > 0),
    ),
  ]
}

/** Filtra um eixo de enum pelos válidos (descarta inválidos individualmente), e SÓ ENTÃO capa. */
function enumValues<T extends string>(raw: string | null, guard: (v: string) => v is T): T[] {
  return csvValues(raw)
    .filter(guard)
    .slice(0, MAX_FACET_VALUES)
}

/** Parse de um bound numérico: `Number()`; NaN/fora-de-faixa ⇒ undefined (ignorado). */
function parseBound(raw: string | null, valid: (n: number) => boolean): number | undefined {
  if (raw === null) return undefined
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  const n = Number(trimmed)
  if (!Number.isFinite(n) || !valid(n)) return undefined
  return n
}

/** Monta a faixa min/max de um eixo numérico; undefined se nenhum bound válido. */
function parseFaixa(
  getMin: string | null,
  getMax: string | null,
  valid: (n: number) => boolean,
): FaixaFacet | undefined {
  const min = parseBound(getMin, valid)
  const max = parseBound(getMax, valid)
  if (min === undefined && max === undefined) return undefined
  const faixa: FaixaFacet = {}
  if (min !== undefined) faixa.min = min
  if (max !== undefined) faixa.max = max
  return faixa
}

/**
 * Parse dos params de faceta a partir de um lookup `(key) => string | null`
 * (tipicamente `url.searchParams.get`). Degrada permissivamente.
 *
 * Nomes EXATOS dos params (contrato de URL público, forks B/C):
 *  cozinha, categoria, tag, restricao (CSV) — dificuldade_min/max, porcoes_min/max (int).
 */
export function parseFacetParams(
  get: (k: string) => string | null,
  activeCozinhas: ReadonlySet<string>,
): EffectiveFacets {
  const facets: EffectiveFacets = {
    // Cozinha data-driven (#316): pertencimento ao conjunto ATIVO injetado, não ao `COZINHAS`.
    // O guard `v is Cozinha` é SÃO porque a borda injeta um conjunto enum-limitado (active ∩
    // COZINHAS via `.filter(isCozinha)`) até a virada #318 — nenhum slug não-enumerável entra.
    cozinhas: enumValues(get('cozinha'), (v): v is Cozinha => activeCozinhas.has(v)),
    categorias: enumValues(get('categoria'), isCategoria),
    tags: [
      ...new Set(csvValues(get('tag')).map(foldIntent).filter((t) => t.length > 0)),
    ].slice(0, MAX_FACET_VALUES),
    restricoes: enumValues(get('restricao'), isRestricao),
  }

  const dificuldade = parseFaixa(
    get('dificuldade_min'),
    get('dificuldade_max'),
    isDificuldadeValida,
  )
  if (dificuldade !== undefined) facets.dificuldade = dificuldade

  const porcoes = parseFaixa(get('porcoes_min'), get('porcoes_max'), isPorcoesValidas)
  if (porcoes !== undefined) facets.porcoes = porcoes

  return facets
}
