import type { Metadata } from 'next'
import { SeusDireitos } from '@/components/legal/seus-direitos'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Página "Seus direitos / Privacidade" + formulário público de intake (#399, GAP-2;
 * `docs/legal/takedown-e-remocao-titular.md` §2). GATED — espelha `[locale]/privacidade`:
 *   • bilíngue (`[locale]`), mas NÃO anunciada: sem link em header/footer/nav (só por URL digitada);
 *   • `robots: noindex/nofollow` + fora do `sitemap.ts` (nenhum crawler a descobre);
 *   • placeholders `{...}` (nome/e-mail do encarregado) viram BADGE de TODO visível.
 *
 * PARA PUBLICAR (não fazer sem sign-off jurídico da #276): preencher os placeholders, garantir que o
 * e-mail do encarregado EXISTE, adicionar o link no rodapé e remover o `noindex`. O FORMULÁRIO já é
 * funcional (abre ticket + grava `DSAR_RECEIVED`) — construir agora, anunciar depois.
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
    // Gated: rascunho não indexado nem seguido enquanto aguarda sign-off jurídico + canal publicado.
    robots: { index: false, follow: false },
  }
}

export default function SeusDireitosPage() {
  // O `<Container as="main">` (o único <main> do documento) e o `<h1>` localizado vivem dentro do
  // SeusDireitos (client, useLocale) — espelha o padrão de privacidade/not-found/cooks.
  return <SeusDireitos />
}
