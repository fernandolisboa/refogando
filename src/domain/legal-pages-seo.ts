import type { Metadata } from 'next'
import type { Locale } from '@/i18n/locale'
import { localizedPageAlternates } from '@/domain/page-seo'

/**
 * Canonical e hreflang das páginas legais (#611): `/termos`, `/privacidade` e `/seus-direitos`. A regra (origem
 * fixa em `www.refogando.com`, hreflang do sitemap) virou geral em `@/domain/page-seo` (ADR-0061).
 */
export type LegalPagePath = 'termos' | 'privacidade' | 'seus-direitos'

export function legalPageAlternates(locale: Locale, path: LegalPagePath): NonNullable<Metadata['alternates']> {
  return localizedPageAlternates(locale, path)
}
