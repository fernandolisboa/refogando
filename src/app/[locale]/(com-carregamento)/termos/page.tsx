import type { Metadata } from 'next'
import { TermsOfUse } from '@/components/legal/terms-of-use'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'
import { legalPageAlternates } from '@/domain/legal-pages-seo'

/**
 * Termos de Uso v1 (ADR-0051; parecer interno §7 e §8) — PUBLICADOS:
 *   • indexáveis (sem `robots: noindex`), listados no `sitemap.ts`, linkados no rodapé e na linha do cadastro;
 *   • o texto vive nas strings i18n (`messages.termos`); mudança relevante pede o aviso no app 15 dias antes
 *     (item 10, `src/domain/legal-notice.ts`). Segmento em português como as outras páginas legais (CONTEXT.md,
 *     "Convenção de URL").
 *
 * `generateMetadata` lê só `params` (sem `headers()`/DB/`getBaseUrlFromEnv`; o canonical e o hreflang usam a origem fixa, #611) ⇒ build-safe (igual a /privacidade).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: urlLocale } = await params
  const locale = resolvePageLocale({ urlLocale })
  return {
    title: MESSAGES[locale].termos.metaTitulo,
    alternates: legalPageAlternates(locale, 'termos'),
  }
}

export default function TermosPage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do TermsOfUse
  // (client, useLocale) — mesmo padrão de privacidade/seus-direitos.
  return <TermsOfUse />
}
