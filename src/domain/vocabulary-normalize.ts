/**
 * Normalização de texto livre → vocabulário controlado (categoria, restrição, unidade, cozinha,
 * quantidade). Camada de DOMÍNIO, PURO: sem DB, sem SDK, total e sem throw.
 *
 * Existe porque a saída do modelo NÃO é constrita pelos enums: o `zodOutputFormat` do SDK rebaixa
 * `enum`/`pattern` a DICA na description do JSON Schema, mas o parse LOCAL valida o schema zod e
 * lança — um `categoria: 'Prato principal'` ou `quantidade: '1/2'` virava `parse_failed` → 502 e a
 * geração inteira era perdida. Aqui: casa o que dá pra casar (caixa, acento, plural, sinônimo PT/EN)
 * e devolve `null` quando não reconhece, para o chamador cair no fallback (campo null / item
 * descartado) em vez de falhar. Mesmo princípio do `originalLocale` no #548.
 *
 * Conservador de propósito: só sinônimos sem ambiguidade. Em restrição alimentar (contrato de
 * adequação, ADR-0004), um sinônimo errado afirmaria uma dieta que a receita não cumpre, então
 * na dúvida o termo é descartado, nunca "adivinhado".
 */

import { slugify } from '@/domain/handle'
import {
  isCategoria,
  isRestricao,
  isUnidade,
  type Categoria,
  type Cozinha,
  type Restricao,
  type Unidade,
} from '@/domain/vocabulary'
import { COZINHA_SEED } from '@/domain/vocabulary-term'

// `quantidade` casa com `recipe_ingredient.quantidade` `numeric(10,3)`: null OU numérico válido ('-'
// opcional, até 7 inteiros, '.' + 1-3 fracionários). Fonte única do schema de geração e do `classify`.
export const QUANTIDADE_RE = /^-?\d{1,7}(\.\d{1,3})?$/

/** Minúsculas, sem acento, com `_ - . / ( )` e espaços colapsados em UM espaço. */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[\s_\-./()]+/g, ' ')
    .trim()
}

// Unidades reconhecíveis em texto livre → nosso enum `Unidade`. Só aliases comuns PT/EN sem
// ambiguidade. Chaves em minúsculas; as acentuadas ficam porque o import (recipe-import-parse)
// casa sem tirar acento. O que não casar fica sem unidade.
export const UNIT_ALIASES: Record<string, Unidade> = {
  // métricas (PT/EN compartilham)
  g: 'g', gr: 'g', grama: 'g', gramas: 'g', gram: 'g', grams: 'g',
  kg: 'kg', quilo: 'kg', quilos: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', mililitro: 'ml', mililitros: 'ml',
  l: 'l', litro: 'l', litros: 'l', liter: 'l', liters: 'l',
  // colheres
  'colher de sopa': 'colher_de_sopa', 'colheres de sopa': 'colher_de_sopa',
  tablespoon: 'colher_de_sopa', tablespoons: 'colher_de_sopa', tbsp: 'colher_de_sopa',
  'colher de cha': 'colher_de_cha', 'colheres de cha': 'colher_de_cha',
  'colher de chá': 'colher_de_cha', 'colheres de chá': 'colher_de_cha',
  teaspoon: 'colher_de_cha', teaspoons: 'colher_de_cha', tsp: 'colher_de_cha',
  // volume
  xicara: 'xicara', xicaras: 'xicara', xícara: 'xicara', xícaras: 'xicara',
  cup: 'xicara', cups: 'xicara',
  // contáveis
  unidade: 'unidade', unidades: 'unidade', unit: 'unidade', units: 'unidade',
  dente: 'dente', dentes: 'dente', clove: 'dente', cloves: 'dente',
  fatia: 'fatia', fatias: 'fatia', slice: 'fatia', slices: 'fatia',
  pitada: 'pitada', pitadas: 'pitada', pinch: 'pitada', pinches: 'pitada',
  // não-mensuráveis
  'a gosto': 'a_gosto', 'to taste': 'a_gosto',
  'q b': 'q_b', qb: 'q_b', 'quanto baste': 'q_b',
}

const CATEGORIA_ALIASES: Record<string, Categoria> = {
  'prato principal': 'prato_principal', principal: 'prato_principal',
  'main course': 'prato_principal', 'main dish': 'prato_principal', main: 'prato_principal',
  appetizer: 'entrada', starter: 'entrada',
  dessert: 'sobremesa',
  drink: 'bebida', beverage: 'bebida',
  sauce: 'molho',
  side: 'acompanhamento', 'side dish': 'acompanhamento',
  snack: 'lanche',
  'cafe da manha': 'cafe_da_manha', breakfast: 'cafe_da_manha',
}

// Só sinônimos que afirmam EXATAMENTE a mesma restrição (ou uma mais forte que a implica: sem
// laticínios ⇒ sem lactose). "shellfish free" fica de fora: não implica sem peixe/frutos do mar.
const RESTRICAO_ALIASES: Record<string, Restricao> = {
  'gluten free': 'sem_gluten',
  'lactose free': 'sem_lactose', 'dairy free': 'sem_lactose', 'sem laticinios': 'sem_lactose',
  vegan: 'vegano',
  vegetarian: 'vegetariano',
  'sugar free': 'sem_acucar',
  'nut free': 'sem_oleaginosas',
  'seafood free': 'sem_frutos_do_mar',
}

/** Chave de lookup: `fold` + espaço→`_` (a forma dos slugs dos enums). */
function enumKey(s: string): string {
  return fold(s).replace(/ /g, '_')
}

/** Unidade livre → enum `Unidade`, ou `null` se não reconhecida. */
export function normalizeUnidade(raw: string): Unidade | null {
  if (isUnidade(raw)) return raw
  const key = enumKey(raw)
  if (isUnidade(key)) return key
  return UNIT_ALIASES[fold(raw)] ?? null
}

/** Categoria livre → enum `Categoria`, ou `null` se não reconhecida. */
export function normalizeCategoria(raw: string): Categoria | null {
  if (isCategoria(raw)) return raw
  const key = enumKey(raw)
  if (isCategoria(key)) return key
  return CATEGORIA_ALIASES[fold(raw)] ?? null
}

/** Restrição livre → enum `Restricao`, ou `null` se não reconhecida (o chamador a descarta). */
export function normalizeRestricao(raw: string): Restricao | null {
  if (isRestricao(raw)) return raw
  const key = enumKey(raw)
  if (isRestricao(key)) return key
  return RESTRICAO_ALIASES[fold(raw)] ?? null
}

// Rótulos PT/EN da seed → slug (ex.: 'Italian' → 'italiana'). Só as cozinhas da seed têm rótulo
// aqui; as aprovadas pela curadoria casam pelo slug.
const COZINHA_LABEL_TO_SLUG: ReadonlyMap<string, string> = new Map(
  COZINHA_SEED.flatMap((t) => [
    [slugify(t.labelPtBr), t.slug],
    [slugify(t.labelEnUs), t.slug],
  ]),
)

/**
 * Cozinha livre → slug do CONJUNTO ATIVO, ou `null` se não casa nenhum (a FK de `recipe.cozinha`
 * rejeitaria um slug fora de `vocabulary_term`). Conjunto vazio ⇒ sem constraint: devolve o valor
 * como veio (mesma regra do schema estático, #318).
 */
export function normalizeCozinha(raw: string, active: ReadonlySet<string>): Cozinha | null {
  if (active.size === 0 || active.has(raw)) return raw
  const slug = slugify(raw)
  if (active.has(slug)) return slug
  const fromLabel = COZINHA_LABEL_TO_SLUG.get(slug)
  return fromLabel !== undefined && active.has(fromLabel) ? fromLabel : null
}

const FRACOES: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
}
const FRAC = '[½⅓⅔¼¾⅕⅛⅜⅝⅞]'
// O PRIMEIRO número da string, em uma destas formas: fração "1/2"; inteiro/decimal com fração
// opcional colada ("1 1/2", "1½"); fração unicode sozinha ("½").
const PRIMEIRO_NUMERO = new RegExp(
  `(\\d+)\\s*/\\s*(\\d+)|(\\d+(?:\\.\\d+)?)(?:\\s*(?:(\\d+)\\s*/\\s*(\\d+)|(${FRAC})))?|(${FRAC})`,
)

/**
 * Quantidade livre → string no formato de `numeric(10,3)`, ou `null` se não há número utilizável.
 * Aceita vírgula decimal ("2,5"), fração ("1/2", "1 1/2", "½", "1½"), faixa ("2-3", "2 a 3" → o
 * primeiro número) e número seguido de texto ("2 xícaras" → "2"). Sem número ("a gosto") ⇒ null.
 * Arredonda para 3 casas; estouro de 7 dígitos inteiros ou zero ⇒ null.
 */
export function normalizeQuantidade(raw: string): string | null {
  const t = raw.trim()
  if (QUANTIDADE_RE.test(t)) return t
  const m = PRIMEIRO_NUMERO.exec(t.replace(/(\d),(\d)/g, '$1.$2'))
  if (!m) return null
  let value: number
  if (m[1] !== undefined) value = Number(m[1]) / Number(m[2])
  else if (m[7] !== undefined) value = FRACOES[m[7]]
  else {
    value = Number(m[3])
    if (m[4] !== undefined) value += Number(m[4]) / Number(m[5])
    else if (m[6] !== undefined) value += FRACOES[m[6]]
  }
  const rounded = Math.round(value * 1000) / 1000
  if (!Number.isFinite(rounded) || rounded <= 0) return null
  const s = String(rounded)
  return QUANTIDADE_RE.test(s) ? s : null
}
