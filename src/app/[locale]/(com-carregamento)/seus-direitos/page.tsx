import type { Metadata } from 'next'
import { SeusDireitos } from '@/components/legal/seus-direitos'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'
import { legalPageAlternates } from '@/domain/legal-pages-seo'

/**
 * Página "Seus direitos / Privacidade" + formulário público de intake (#399, GAP-2; parte de #276;
 * `docs/legal/takedown-e-remocao-titular.md` §2) — PUBLICADA.
 *
 * Revisada no parecer interno de 2026-10-22 (`docs/legal/parecer-interno-2026-10-22.md`), que fechou o
 * #276 (v3):
 *   • indexável (sem `robots: noindex`), listada no `sitemap.ts` e linkada no rodapé;
 *   • o contato do canal está escrito DIRETO nas strings i18n (`messages.seusDireitos`/
 *     `messages.privacidade`) — o dono troca ali; o canal (e-mail + formulário) é funcional (abre ticket +
 *     grava `DSAR_RECEIVED`).
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
    title: MESSAGES[locale].seusDireitos.metaTitulo,
    alternates: legalPageAlternates(locale, 'seus-direitos'),
  }
}

export default function SeusDireitosPage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do
  // SeusDireitos (client, useLocale) — espelha o padrão de privacidade/not-found/cooks.
  return <SeusDireitos />
}
