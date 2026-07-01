import type { Metadata } from 'next'
import { PrivacyPolicy } from '@/components/legal/privacy-policy'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Política de Privacidade (#398 / #276) — RASCUNHO jurídico atrás de FLAG.
 *
 * GATED de propósito: a rota EXISTE e é bilíngue (`[locale]`), mas NÃO é anunciada —
 *   • não há link em header/footer/nav (só se alcança digitando a URL);
 *   • `robots: noindex/nofollow` + fora do `sitemap.ts` (o sitemap só lista home + receitas indexáveis);
 * então nenhum crawler a descobre. O conteúdo vem do rascunho revisado por advogado da #276
 * (`docs/legal/politica-de-privacidade-secao-descoberta-web.md`).
 *
 * PARA PUBLICAR (não fazer sem sign-off jurídico da #276): preencher os placeholders `{...}`
 * (razão social, CNPJ, e-mail do encarregado), garantir que o canal de takedown/encarregado da
 * Parte (b.5) EXISTE, adicionar o link no rodapé e remover o `noindex`. Ver `privacy-policy.tsx`.
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
    // Gated: rascunho não indexado nem seguido enquanto aguarda sign-off jurídico.
    robots: { index: false, follow: false },
  }
}

export default function PrivacidadePage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do
  // PrivacyPolicy (client, useLocale) — espelha o padrão de not-found/cooks.
  return <PrivacyPolicy />
}
