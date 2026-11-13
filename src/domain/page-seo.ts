import type { Metadata } from 'next'
import type { Locale } from '@/i18n/locale'
import { staticPathHreflang } from '@/domain/sitemap'

/**
 * Canonical e hreflang das páginas públicas por locale que não são o detalhe da receita nem a home (#611,
 * ADR-0061): páginas legais, `/guia`, `/plano`, `/sign-in`, `/sign-up` e o perfil `/u/<handle>`. PURO.
 *
 * A origem é FIXA no domínio público de produção (`www.refogando.com`; o apex redireciona para ele na Vercel), e
 * não a `getBaseUrlFromEnv`: várias destas páginas são estáticas com ISR, então o `generateMetadata` roda no build,
 * e o build do CI não tem `APP_URL`/`VERCEL_URL` (a função lança em produção sem eles). Num preview o canonical
 * aponta para a produção, que é o que se quer: o preview não deve ser a versão canônica de nada. O sitemap lista
 * as mesmas URLs pela env (em produção, `VERCEL_PROJECT_PRODUCTION_URL` = www): se a origem pública mudar, as duas
 * mudam juntas (nota em `base-url.ts`). O esquema de hreflang é o do sitemap (`staticPathHreflang`).
 *
 * Por que todas declaram canonical (ADR-0061): sem ele, `/pt-BR/x` e `/en-US/x` (mesmo conteúdo, só a chrome
 * muda) e as variantes com query (`?returnTo=`, `?ref=`) apareciam no Search Console como "Cópia sem página
 * canônica selecionada pelo usuário". Cada idioma é canônico de si mesmo e aponta o outro pelo hreflang.
 */
export const CANONICAL_ORIGIN = 'https://www.refogando.com'

/** `path` sem barra inicial nem locale (ex.: `guia`, `u/ana`). */
export function localizedPageAlternates(locale: Locale, path: string): NonNullable<Metadata['alternates']> {
  return { canonical: `${CANONICAL_ORIGIN}/${locale}/${path}`, languages: staticPathHreflang(CANONICAL_ORIGIN, path) }
}
