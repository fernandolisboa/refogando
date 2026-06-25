/**
 * Página "Seguindo" (#277, ADR-0024) — Server Component fino. Provê o ÚNICO `<main>` do documento
 * via `<Container as="main">` + o `<h1>` localizado (que NÃO vive no client feed — assim o estado
 * vazio/lista/guest do client nunca precisa emitir outro `<h1>`). Monta o `FollowingFeed`, que
 * resolve sessão+locale e busca `GET /api/feed/following` no cliente (o fetch do browser leva o
 * cookie de sessão nativamente — é uma superfície PER-VIEWER).
 *
 * SUPERFÍCIE SÓ-LOGADA e NÃO-INDEXÁVEL (Modelo B / ADR-0020): `generateMetadata` emite
 * `robots: { index:false, follow:false }`. SEPARADA da home anon/indexável — o feed Seguindo NUNCA
 * personaliza a Descoberta nem o perfil. Sem canonical/hreflang (não indexa).
 *
 * O locale do TÍTULO/`<h1>` vem de `params.locale` (a URL é a fonte da verdade do idioma, ADR-0020 —
 * espelha o `[locale]/layout`, NÃO o cookie de `/me/recipes`), pra o SSR bater com a chrome
 * hidratada (LocaleProvider). Como só lê `params` (sem `cookies()`/`headers()`), o título é estável.
 */
import type { Metadata } from 'next'
import { Container } from '@/components/container'
import { FollowingFeed } from '@/components/recipe/following-feed'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: pathLocale } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  return {
    title: MESSAGES[locale].seguindoFeed.titulo,
    // NÃO-INDEXÁVEL (AC3): superfície só-logada e personalizada — fora do índice e do follow.
    robots: { index: false, follow: false },
  }
}

export default async function FollowingPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale: pathLocale } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  const m = MESSAGES[locale].seguindoFeed

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.subtitulo}</p>
      </div>
      <FollowingFeed />
    </Container>
  )
}
