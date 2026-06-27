/**
 * Rótulos de cozinha localizados a partir do leitor data-driven (#317, ADR-0025).
 *
 * PURO e CLIENT-SAFE: nenhum `'use client'`, nenhum import de DB. O único import é de
 * TIPO (`VocabularyTermView`), que o compilador apaga — então este módulo entra tanto no
 * servidor (layout/página resolvem aqui) quanto no cliente (forms recebem `CozinhaOption[]`
 * já resolvido via contexto). A regra de locale vive AQUI, uma vez: o cliente fica burro.
 *
 * Substitui o antigo `messages.cozinhaLabel` (mapa estático no i18n): os rótulos agora vêm
 * das linhas de `vocabulary_term` (leitor #315), não de um `Record<Cozinha,string>` congelado.
 */
import type { Locale } from '@/i18n/locale'
import type { ReadonlyVocabulary, VocabularyTermView } from '@/server/vocabulary/load'

/** Opção de cozinha já localizada: `value` = slug controlado, `label` = rótulo do locale. */
export type CozinhaOption = { value: string; label: string }

/**
 * Rótulo de um termo no locale pedido, com cadeia de fallback determinística:
 * rótulo-do-locale → rótulo-do-OUTRO-locale → o próprio slug. Garante que um termo recém
 * semeado sem tradução num idioma ainda renderize algo legível (nunca string vazia).
 */
export function pickCozinhaLabel(
  term: Pick<VocabularyTermView, 'slug' | 'labelPtBr' | 'labelEnUs'>,
  locale: Locale,
): string {
  const preferida = locale === 'pt-BR' ? term.labelPtBr : term.labelEnUs
  const outra = locale === 'pt-BR' ? term.labelEnUs : term.labelPtBr
  return preferida ?? outra ?? term.slug
}

/**
 * Localiza um vocabulário inteiro (snapshot do leitor) num locale, PRESERVANDO a ordem das
 * linhas (o leitor já ordena por `sort`/slug). Resultado pronto pro contexto/forms.
 */
export function localizeCozinhaVocab(
  vocab: ReadonlyVocabulary,
  locale: Locale,
): CozinhaOption[] {
  return vocab.map((term) => ({ value: term.slug, label: pickCozinhaLabel(term, locale) }))
}

/**
 * Resolve o rótulo de exibição de UM slug gravado (ex. a cozinha de uma Receita no detalhe):
 *  - `slug == null` → `null` (faceta ausente; nada a renderizar — "ausente ≠ vazio").
 *  - achou a opção → o rótulo localizado.
 *  - não achou (slug fora do escopo carregado) → o próprio slug cru (defensivo, nunca quebra).
 */
export function resolveCozinhaLabel(
  options: readonly CozinhaOption[],
  slug: string | null,
): string | null {
  if (slug == null) return null
  return options.find((o) => o.value === slug)?.label ?? slug
}
