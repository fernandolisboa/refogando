import type { Metadata } from 'next'
import type { Locale } from '@/i18n/locale'
import { staticPathHreflang } from '@/domain/sitemap'

/**
 * Canonical e hreflang das páginas legais (#611): `/termos`, `/privacidade` e `/seus-direitos`. PURO.
 *
 * A origem é FIXA no domínio público de produção (`www.refogando.com`; o apex redireciona para ele na Vercel), e
 * não a `getBaseUrlFromEnv`: as três páginas são estáticas com ISR, então o `generateMetadata` roda no build, e o
 * build do CI não tem `APP_URL`/`VERCEL_URL` (a função lança em produção sem eles). Num preview o canonical aponta
 * para a produção, que é o que se quer: o preview não deve ser a versão canônica de nada. O sitemap lista as mesmas
 * URLs pela env (em produção, `VERCEL_PROJECT_PRODUCTION_URL` = www): se a origem pública mudar, as duas mudam juntas
 * (nota em `base-url.ts`). O esquema de hreflang é o do sitemap (`staticPathHreflang`).
 */
const CANONICAL_ORIGIN = 'https://www.refogando.com'

export type LegalPagePath = 'termos' | 'privacidade' | 'seus-direitos'

export function legalPageAlternates(locale: Locale, path: LegalPagePath): NonNullable<Metadata['alternates']> {
  return { canonical: `${CANONICAL_ORIGIN}/${locale}/${path}`, languages: staticPathHreflang(CANONICAL_ORIGIN, path) }
}
