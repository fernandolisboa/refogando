/**
 * Normalização de texto livre → vocabulário controlado (categoria, restrição, unidade, cozinha) e
 * medida (quantidade + unidade). Camada de DOMÍNIO, PURO: sem DB, sem SDK, total e sem throw.
 *
 * Existe porque a saída do modelo NÃO é constrita pelos enums: o `zodOutputFormat` do SDK rebaixa
 * `enum`/`pattern` a DICA na description do JSON Schema, mas o parse LOCAL valida o schema zod e
 * lança — um `categoria: 'Prato principal'` ou `quantidade: '1/2'` virava `parse_failed` → 502 e a
 * geração inteira era perdida. Aqui: casa o que dá pra casar (caixa, acento, plural, sinônimo PT/EN)
 * e devolve `null` quando não reconhece, para o chamador cair no fallback (campo null / item
 * descartado) em vez de falhar. Mesmo princípio do `originalLocale` no #548.
 *
 * Conservador de propósito: só sinônimos sem ambiguidade, e nunca um número adivinhado. Em
 * restrição alimentar (contrato de adequação, ADR-0004), um sinônimo errado afirmaria uma dieta que
 * a receita não cumpre; em quantidade, um separador ambíguo ("1,000") pode errar por 1000×. Na
 * dúvida o valor cai no fallback, nunca é "adivinhado".
 *
 * As tabelas são `Map` (não objeto literal): uma chave como 'constructor' leria o protótipo.
 */

import { slugify } from '@/domain/handle'
import { normalizeText } from '@/domain/recipe-restrictions'
import {
  QUANTIDADE_RE,
  isCategoria,
  isRestricao,
  isUnidade,
  type Categoria,
  type Cozinha,
  type Restricao,
  type Unidade,
} from '@/domain/vocabulary'
import { COZINHA_SEED } from '@/domain/vocabulary-term'

/** `normalizeText` (minúsculas, sem acento) com `_ - . / ( )` e espaços colapsados em UM espaço. */
function fold(s: string): string {
  return normalizeText(s).replace(/[\s_\-./()]+/g, ' ').trim()
}

/** Chave de lookup: `fold` + espaço→`_` (a forma dos slugs dos enums). */
function enumKey(s: string): string {
  return fold(s).replace(/ /g, '_')
}

/** Tabela de aliases indexada pela forma `fold`: `[[alias, valor], …]` e `[[[alias, …], valor], …]`. */
function aliases<T>(entries: ReadonlyArray<readonly [string | readonly string[], T]>): ReadonlyMap<string, T> {
  const m = new Map<string, T>()
  for (const [keys, value] of entries) {
    for (const k of typeof keys === 'string' ? [keys] : keys) m.set(fold(k), value)
  }
  return m
}

// Unidades reconhecíveis em texto livre → nosso enum `Unidade`. Só aliases comuns PT/EN sem
// ambiguidade. O que não casar fica sem unidade. Também é a tabela do import (recipe-import-parse).
const UNIDADE_ALIASES = aliases<Unidade>([
  [['g', 'gr', 'grama', 'gramas', 'gram', 'grams'], 'g'],
  [['kg', 'quilo', 'quilos', 'kilo', 'kilogram', 'kilograms'], 'kg'],
  [['ml', 'mililitro', 'mililitros', 'milliliter', 'milliliters'], 'ml'],
  [['l', 'litro', 'litros', 'liter', 'liters'], 'l'],
  [['colher de sopa', 'colheres de sopa', 'colher sopa', 'colheres sopa', 'tablespoon', 'tablespoons', 'tbsp'], 'colher_de_sopa'],
  [['colher de chá', 'colheres de chá', 'colher chá', 'colheres chá', 'teaspoon', 'teaspoons', 'tsp'], 'colher_de_cha'],
  // 'xícara (chá)' sim; 'xícara de chá' não: no import, '1 xícara de chá verde' é chá verde.
  [['xícara', 'xícaras', 'xícara chá', 'xícaras chá', 'cup', 'cups'], 'xicara'],
  [['unidade', 'unidades', 'unit', 'units'], 'unidade'],
  [['dente', 'dentes', 'clove', 'cloves'], 'dente'],
  [['fatia', 'fatias', 'slice', 'slices'], 'fatia'],
  [['pitada', 'pitadas', 'pinch', 'pinches'], 'pitada'],
  [['a gosto', 'to taste'], 'a_gosto'],
  [['q.b.', 'qb', 'quanto baste'], 'q_b'],
])

// Categoria: rótulos de i18n (pt-BR/en-US), plurais e sinônimos EN usuais.
const CATEGORIA_ALIASES = aliases<Categoria>([
  [['entradas', 'starter', 'starters', 'appetizer', 'appetizers'], 'entrada'],
  [['pratos principais', 'principal', 'main', 'main course', 'main dish'], 'prato_principal'],
  [['sobremesas', 'dessert', 'desserts'], 'sobremesa'],
  [['bebidas', 'drink', 'drinks', 'beverage', 'beverages'], 'bebida'],
  [['molhos', 'sauce', 'sauces'], 'molho'],
  [['acompanhamentos', 'side', 'sides', 'side dish'], 'acompanhamento'],
  [['lanches', 'snack', 'snacks'], 'lanche'],
  [['café da manhã', 'breakfast'], 'cafe_da_manha'],
])

// Restrição: só termos que afirmam a MESMA restrição (os rótulos de i18n de cada locale, inclusive o
// feminino pt 'vegana' e o en 'shellfish-free' do app) ou uma mais forte que a implica (sem
// laticínios ⇒ sem lactose).
const RESTRICAO_ALIASES = aliases<Restricao>([
  ['gluten-free', 'sem_gluten'],
  [['lactose-free', 'dairy-free', 'sem laticínios'], 'sem_lactose'],
  [['vegana', 'vegan'], 'vegano'],
  [['vegetariana', 'vegetarian'], 'vegetariano'],
  ['sugar-free', 'sem_acucar'],
  ['nut-free', 'sem_oleaginosas'],
  [['shellfish-free', 'seafood-free'], 'sem_frutos_do_mar'],
])

/** Unidade livre → enum `Unidade`, ou `null` se não reconhecida. */
export function normalizeUnidade(raw: string): Unidade | null {
  if (isUnidade(raw)) return raw
  const key = enumKey(raw)
  if (isUnidade(key)) return key
  return UNIDADE_ALIASES.get(fold(raw)) ?? null
}

/** Categoria livre → enum `Categoria`, ou `null` se não reconhecida. */
export function normalizeCategoria(raw: string): Categoria | null {
  if (isCategoria(raw)) return raw
  const key = enumKey(raw)
  if (isCategoria(key)) return key
  return CATEGORIA_ALIASES.get(fold(raw)) ?? null
}

/** Restrição livre → enum `Restricao`, ou `null` se não reconhecida (o chamador a descarta). */
export function normalizeRestricao(raw: string): Restricao | null {
  if (isRestricao(raw)) return raw
  const key = enumKey(raw)
  if (isRestricao(key)) return key
  return RESTRICAO_ALIASES.get(fold(raw)) ?? null
}

// Rótulos PT/EN da SEED → slug (ex.: 'Italian' → 'italiana'). Só as cozinhas da seed têm rótulo aqui:
// rótulos editados/aprovados pela curadoria em `vocabulary_term` (ADR-0025) casam só pelo slug.
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
// Um número no INÍCIO da string, numa destas formas (em ordem): misto "1 1/2" / "1-1/2"; fração
// "1/2"; decimal/inteiro com fração unicode opcional ("2.5", ".5", "1½", "1 ½"); fração unicode "½".
const NUMERO_INICIAL = new RegExp(
  `^(?:(\\d+)(?:\\s+|\\s*-\\s*)(\\d+)\\s*/\\s*(\\d+)|(\\d+)\\s*/\\s*(\\d+)|(\\d*\\.\\d+|\\d+)(?:\\s*(${FRAC}))?|(${FRAC}))`,
)

// Cauda de uma faixa depois do 1º número: "-3", "– 3", "a 3", "ou 3", "to 3 cups" (grupo 1: unidade).
const FAIXA_CAUDA = new RegExp(
  `^(?:[-–]|a|ou|to|or)\\s*(?:\\d*\\.\\d+|\\d+(?:\\s*/\\s*\\d+)?|${FRAC})(?:\\s*([\\p{L}][\\p{L} .()]*))?$`,
  'iu',
)

/** Medida normalizada. `resto` é o texto que sobrou sem ser entendido (''= nada se perdeu). */
export type Medida = { quantidade: string | null; unidade: Unidade | null; resto: string }

/**
 * Quantidade livre → medida no formato de `numeric(10,3)` + a unidade, quando vem colada ("2
 * xícaras" → 2 / xicara). Aceita vírgula decimal ("2,5"), fração ("1/2", "1 1/2", "1-1/2", "½",
 * "1½"), ".5", e prefixo textual ("cerca de 2"). "a gosto"/"q.b." viram a unidade não-mensurável.
 *
 * Nunca adivinha um número: separador de milhar ambíguo ("1,000", "1.000,5"), notação científica,
 * sinal negativo, zero e estouro de 7 inteiros ⇒ quantidade null. Faixa ("2-3", "2 a 3") vira o
 * primeiro número e devolve o resto em `resto`, para o chamador registrar a perda.
 */
export function parseMedida(raw: string): Medida {
  const t = raw.trim()
  const semNumero = (resto: string): Medida => ({ quantidade: null, unidade: null, resto })
  if (t === '') return semNumero('')
  if (QUANTIDADE_RE.test(t)) return Number(t) > 0 ? { quantidade: t, unidade: null, resto: '' } : semNumero(t)

  const soUnidade = normalizeUnidade(t)
  if (soUnidade === 'a_gosto' || soUnidade === 'q_b') return { quantidade: null, unidade: soUnidade, resto: '' }

  // Ambiguidade que erraria por ordens de grandeza: milhar com vírgula, os dois separadores juntos,
  // notação científica.
  if (/\d,\d{3}(?!\d)/.test(t) || /\d[.,]\d+[.,]\d/.test(t) || /\d[eE][+-]?\d/.test(t)) return semNumero(t)
  const s = t.replace(/(\d),(\d)/g, '$1.$2') // vírgula decimal (mesmo comprimento: índices valem em t)
  const inicio = s.search(new RegExp(`\\d|\\.\\d|${FRAC}`))
  if (inicio < 0) return semNumero(t)
  // Sinal negativo (hífen, travessão, menos) não é quantidade de ingrediente.
  const prefixo = s.slice(0, inicio)
  if (/[-–−]\s*$/.test(prefixo)) return semNumero(t)
  const m = NUMERO_INICIAL.exec(s.slice(inicio))
  if (!m) return semNumero(t)

  let value: number
  if (m[1] !== undefined) value = Number(m[1]) + Number(m[2]) / Number(m[3])
  else if (m[4] !== undefined) value = Number(m[4]) / Number(m[5])
  else if (m[8] !== undefined) value = FRACOES[m[8]]
  else value = Number(m[6]) + (m[7] !== undefined ? FRACOES[m[7]] : 0)

  const rounded = Math.round(value * 1000) / 1000
  const quantidade = String(rounded)
  if (!Number.isFinite(rounded) || rounded <= 0 || !QUANTIDADE_RE.test(quantidade)) return semNumero(t)

  // O que vem depois do número decide se ele vale:
  //  - nada, ou uma unidade ⇒ vale (e a unidade é aproveitada);
  //  - cauda de faixa ("-3", "a 3 xícaras") ⇒ vale o primeiro número, com a unidade da cauda;
  //  - palavra sem número ("maços") ⇒ vale o número; a palavra vai para o log;
  //  - qualquer outro número ("1 000", "2 x 200g", "2 e 1/2") ⇒ o número lido estaria errado: null.
  // Um qualificador antes do número ("cerca de 2") é aceito, mas vai para o log.
  const perdido = (resto: string) => [prefixo.trim(), resto].filter((x) => x !== '').join(' … ')
  const resto = s.slice(inicio + m[0].length).trim()
  if (resto === '') return { quantidade, unidade: null, resto: perdido('') }
  const unidade = normalizeUnidade(resto)
  if (unidade !== null) return { quantidade, unidade, resto: perdido('') }
  const faixa = FAIXA_CAUDA.exec(resto)
  if (faixa) return { quantidade, unidade: faixa[1] ? normalizeUnidade(faixa[1]) : null, resto: perdido(resto) }
  if (new RegExp(`\\d|${FRAC}`).test(resto)) return semNumero(t)
  return { quantidade, unidade: null, resto: perdido(resto) }
}
