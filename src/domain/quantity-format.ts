/**
 * Formatação de número/fração da medida estruturada (ADR-0012 Adendo 2, decisão 4) — PURO, sem React.
 *
 * A `quantidade` mora como `numeric(10,3)` e volta da rota como string ("3.000", "2.500", "0.333").
 * Três funções, três superfícies:
 *
 *  - `formatQuantityDisplay` (LEITURA): número por locale (vírgula pt / ponto en), SEM zeros à direita
 *    e SEM agrupamento de milhar, com frações comuns viradas em GLIFO (½ ¼ ¾ ⅓ ⅔ ⅛ ⅜ ⅝ ⅞), inclusive
 *    misto ("2½"). O que não casa numa fração comum cai no decimal localizado.
 *  - `formatQuantityInput` (FORMULÁRIO): mesmo número localizado, mas NUNCA glifo — o campo precisa
 *    ser editável/digitável. Mata o bug do `numeric(10,3)` cru ("3.000") no input.
 *  - `parseQuantityInput` (SUBMIT): texto do formulário → string-ponto canônica pro POST; a zod do
 *    servidor é o guard final. Round-trip seguro com `formatQuantityInput` (nunca emitimos agrupamento,
 *    então a única troca é vírgula→ponto).
 */

import { QUANTIDADE_RE } from '@/domain/vocabulary'

/**
 * CONJUNTO RESTRITO de frações com glifo (decisão de gramática): apenas as que leem inequívocas em
 * receita — meios, terços, quartos, oitavos. Fora propositalmente: 1/5, 2/5, 1/6, 5/6 (⅕ ⅖ ⅙ ⅚) — leem
 * mal e colidiriam com o decimal-fallback (0.4 deve virar "0,4", não "⅖").
 */
const FRACTION_GLYPHS: ReadonlyArray<{ value: number; glyph: string }> = [
  { value: 1 / 2, glyph: '½' },
  { value: 1 / 4, glyph: '¼' },
  { value: 3 / 4, glyph: '¾' },
  { value: 1 / 3, glyph: '⅓' },
  { value: 2 / 3, glyph: '⅔' },
  { value: 1 / 8, glyph: '⅛' },
  { value: 3 / 8, glyph: '⅜' },
  { value: 5 / 8, glyph: '⅝' },
  { value: 7 / 8, glyph: '⅞' },
]

/**
 * Tolerância de casamento da fração. 0.005 absorve a truncagem do `numeric(10,3)` (|0.333 − 0.3333| ≈
 * 0.0003) mas mantém um 0.34/0.66 de verdade no decimal.
 */
const EPS = 0.005

/** `Intl.NumberFormat` localizado, sem zeros forçados e SEM agrupamento de milhar (1000 → "1000"). */
function localizedNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3, useGrouping: false }).format(n)
}

/** Lê uma `quantidade` (aceita vírgula defensivamente) → número finito, ou `null` se não-numérica. */
function toNumber(value: string): number | null {
  const n = Number(value.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * LEITURA: número localizado + glifo de fração quando casa o conjunto restrito. Não-número sai cru
 * (nunca `NaN`).
 */
export function formatQuantityDisplay(value: string, locale: string): string {
  const n = toNumber(value)
  if (n === null) return value

  const int = Math.trunc(n)
  const frac = Math.abs(n - int)
  const match = FRACTION_GLYPHS.find((g) => Math.abs(frac - g.value) < EPS)
  if (match) {
    // int===0 → só o glifo ("½"); senão cola o inteiro ("2½", sem espaço).
    return int === 0 ? match.glyph : `${int}${match.glyph}`
  }
  return localizedNumber(n, locale)
}

/**
 * FORMULÁRIO: número localizado SEM glifo (precisa ser editável). null/'' → '' (campo vazio). Não-número
 * (defensivo) sai cru — o usuário corrige.
 */
export function formatQuantityInput(value: string | null, locale: string): string {
  if (value == null || value === '') return ''
  const n = toNumber(value)
  if (n === null) return value
  return localizedNumber(n, locale)
}

/**
 * SUBMIT: texto do formulário → string-ponto canônica (ou `null` se vazio), LOCALE-AWARE. O separador
 * DECIMAL é por locale (vírgula em pt, ponto em en); o outro é o de MILHAR. Troca o decimal por ponto e,
 * se casa o formato numérico aceito, normaliza via `Number` (corta zeros: "1.250" en → "1.25").
 *
 * SEGURANÇA (sem colapso silencioso de milhar): se a entrada CONTÉM o separador de milhar (en "1,000",
 * pt "1.000"), devolve o texto CRU inalterado — a zod do servidor o rejeita (preserva o erro PRÉ-PR).
 * Antes, o cego "primeira vírgula→ponto" virava "1,000" (mil) em "1" em silêncio. Fora do formato,
 * devolve o cru e deixa a zod rejeitar.
 */
export function parseQuantityInput(raw: string, locale: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const decimalSep = locale.startsWith('pt') ? ',' : '.'
  const groupSep = decimalSep === ',' ? '.' : ','
  // Separador de milhar presente ⇒ NÃO colapsa em silêncio: devolve cru, a zod do servidor rejeita.
  if (trimmed.includes(groupSep)) return trimmed
  const dotted = trimmed.replace(decimalSep, '.')
  if (QUANTIDADE_RE.test(dotted)) {
    return String(Number(dotted))
  }
  return trimmed
}
