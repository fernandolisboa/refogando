import type { Metadata } from 'next'
import { PrivacyPolicy } from '@/components/legal/privacy-policy'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Política de Privacidade (#398 / parte de #276) — PUBLICADA.
 *
 * Por decisão do dono, a página foi ao ar SEM o sign-off jurídico (que segue PENDENTE em #276):
 *   • indexável (sem `robots: noindex`), listada no `sitemap.ts` e linkada no rodapé;
 *   • os placeholders foram resolvidos com os contatos reais (`@/domain/legal-contact`).
 * O conteúdo vem do rascunho da #276 (`docs/legal/politica-de-privacidade-secao-descoberta-web.md`);
 * a revisão jurídica formal ainda está em andamento e NÃO bloqueou a publicação.
 *
 * `generateMetadata` lê só `params` (sem `headers()`/DB/`getBaseUrlFromEnv`) ⇒ build-safe.
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
  }
}

export default function PrivacidadePage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do
  // PrivacyPolicy (client, useLocale) — espelha o padrão de not-found/cooks.
  return <PrivacyPolicy />
}
