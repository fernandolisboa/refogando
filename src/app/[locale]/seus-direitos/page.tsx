import type { Metadata } from 'next'
import { SeusDireitos } from '@/components/legal/seus-direitos'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Página "Seus direitos / Privacidade" + formulário público de intake (#399, GAP-2; parte de #276;
 * `docs/legal/takedown-e-remocao-titular.md` §2) — PUBLICADA.
 *
 * Por decisão do dono, a página foi ao ar SEM o sign-off jurídico (que segue PENDENTE em #276):
 *   • indexável (sem `robots: noindex`), listada no `sitemap.ts` e linkada no rodapé;
 *   • os placeholders (nome/e-mail do encarregado) foram resolvidos com os contatos reais
 *     (`@/domain/legal-contact`); o canal (e-mail + formulário) já EXISTE e é funcional
 *     (abre ticket + grava `DSAR_RECEIVED`).
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
    title: MESSAGES[locale].seusDireitos.metaTitulo,
  }
}

export default function SeusDireitosPage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do
  // SeusDireitos (client, useLocale) — espelha o padrão de privacidade/not-found/cooks.
  return <SeusDireitos />
}
