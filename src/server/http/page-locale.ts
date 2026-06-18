import { canonicalLocale, isSupportedLocale, resolveLocale, type Locale } from '@/i18n/locale'

/**
 * Resolve o locale da PÁGINA de detalhe (issue #57), PURO (sem `next/headers`): recebe
 * os 3 insumos crus → devolve `Locale`. É a engrenagem que faz o link "ver o original"
 * (`?locale=originalLocale`) levar à origem SEM trocar o cookie/idioma da chrome.
 *
 * Precedência: `?locale` VÁLIDO da URL → cookie (`preferred`) → Accept-Language. Um
 * `?locale` inválido NÃO derruba a tela (cai no cookie → Accept-Language →
 * DEFAULT_LOCALE, política "nunca tela quebrada" de `resolveLocale`).
 * `isSupportedLocale`/`canonicalLocale` casam case-insensitive (`?locale=PT-br` → `pt-BR`).
 */
export function resolvePageLocale(input: {
  urlLocale?: string | null
  cookieLocale?: string | null
  acceptLanguage?: string | null
}): Locale {
  if (input.urlLocale && isSupportedLocale(input.urlLocale)) {
    return canonicalLocale(input.urlLocale)! // suportado ⇒ nunca null (forma canônica)
  }
  return resolveLocale({
    preferred: input.cookieLocale,
    acceptLanguage: input.acceptLanguage,
  })
}
