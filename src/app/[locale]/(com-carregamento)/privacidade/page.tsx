import type { Metadata } from 'next'
import { PrivacyPolicy } from '@/components/legal/privacy-policy'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'
import { legalPageAlternates } from '@/domain/legal-pages-seo'

/**
 * Política de Privacidade (#398 / parte de #276) — PUBLICADA.
 *
 * Revisada no parecer interno de 2026-10-22 (`docs/legal/parecer-interno-2026-10-22.md`), que fechou o
 * #276 (v3):
 *   • indexável (sem `robots: noindex`), listada no `sitemap.ts` e linkada no rodapé;
 *   • os contatos reais estão escritos DIRETO nas strings i18n (`messages.privacidade`) — o dono troca o
 *     e-mail do canal editando ali.
 * PR que muda dado, finalidade, fornecedor, prazo ou log atualiza o texto no mesmo PR (CLAUDE.md).
 *
 * `generateMetadata` lê só `params` (sem `headers()`/DB/`getBaseUrlFromEnv`; o canonical e o hreflang usam a origem fixa, #611) ⇒ build-safe.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: urlLocale } = await params
  const locale = resolvePageLocale({ urlLocale })
  return {
    title: MESSAGES[locale].privacidade.metaTitulo,
    alternates: legalPageAlternates(locale, 'privacidade'),
  }
}

export default function PrivacidadePage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do
  // PrivacyPolicy (client, useLocale) — espelha o padrão de not-found/cooks.
  return <PrivacyPolicy />
}
