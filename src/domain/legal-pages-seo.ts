import type { Metadata } from 'next'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from '@/i18n/locale'

/**
 * Canonical e hreflang das páginas legais (#611): `/termos`, `/privacidade` e `/seus-direitos`. PURO.
 *
 * A origem é FIXA no domínio público de produção (`www.refogando.com`; o apex redireciona para ele na Vercel), e
 * não a `getBaseUrlFromEnv`: as três páginas são estáticas com ISR, então o `generateMetadata` roda no build, e o
 * build do CI não tem `APP_URL`/`VERCEL_URL` (a função lança em produção sem eles). Num preview o canonical aponta
 * para a produção, que é o que se quer: o preview não deve ser a versão canônica de nada.
 *
 * Mesmo esquema do sitemap para rotas estáticas (`buildStaticPathEntries`, `src/domain/sitemap.ts`): cada locale
 * suportado + `x-default` na versão do `DEFAULT_LOCALE` (não há redirecionador por página na raiz sem locale).
 */
export const CANONICAL_ORIGIN = 'https://www.refogando.com'

export type LegalPagePath = 'termos' | 'privacidade' | 'seus-direitos'

export function legalPageAlternates(locale: Locale, path: LegalPagePath): NonNullable<Metadata['alternates']> {
  const url = (loc: Locale) => `${CANONICAL_ORIGIN}/${loc}/${path}`
  const languages: Record<string, string> = {}
  for (const loc of SUPPORTED_LOCALES) languages[loc] = url(loc)
  languages['x-default'] = url(DEFAULT_LOCALE)
  return { canonical: url(locale), languages }
}
