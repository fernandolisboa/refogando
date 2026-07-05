import type { Metadata } from 'next'
import { MESSAGES, type Messages } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'

/**
 * #462: helpers de `generateMetadata` p/ dar um TÍTULO fino por página — 19 das 25 páginas herdavam o
 * `title: 'Refogando'` do root layout (aba do navegador indistinguível, ruim p/ histórico/tab-switch).
 * Espelha `following/page.tsx`: resolve o locale pelo SEGMENTO da URL (ADR-0020 — a URL é a fonte do
 * idioma, NÃO o cookie), pega o texto que JÁ existe no i18n, e devolve `{ title }`.
 *
 * `pick` recebe o pacote de mensagens do locale e escolhe a string do título (reusa os mesmos rótulos
 * já usados nos `<h1>`/abas — sem string nova).
 */
type LocaleParams = Promise<{ locale: string }>

/** Título fino + NOINDEX — superfície só-logada/personalizada (me/*, create, admin/*), como following. */
export async function loggedInPageMetadata(
  params: LocaleParams,
  pick: (m: Messages) => string,
): Promise<Metadata> {
  const { locale: pathLocale } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  return { title: pick(MESSAGES[locale]), robots: { index: false, follow: false } }
}

/** Título fino, INDEXÁVEL — páginas públicas sem tratamento de SEO especial (sign-in/up). */
export async function publicPageMetadata(
  params: LocaleParams,
  pick: (m: Messages) => string,
): Promise<Metadata> {
  const { locale: pathLocale } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  return { title: pick(MESSAGES[locale]) }
}
