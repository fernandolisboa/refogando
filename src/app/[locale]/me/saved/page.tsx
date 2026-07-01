/**
 * Página "Salvos" (#364) — Server Component fino, espelha `/me/recipes`. Provê o único `<main>`
 * via `<Container as="main">` + o `<h1>` localizado (o client não emite outro `<h1>`), e monta o
 * `<SavedRecipesView />`, que resolve sessão+locale e busca as coleções/salvos no cliente (o fetch
 * do browser leva o cookie de sessão nativamente, então o dono lê seus próprios salvos privados).
 *
 * URL em inglês (CONTEXT.md): /me/saved. O TÍTULO precisa do locale para o SSR bater com o client —
 * resolvido como nas pages de detalhe/criações: precedência cookie → Accept-Language (sem `?locale`).
 */
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { SavedRecipesView } from '@/components/recipe/saved-recipes-view'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'

export default async function SavedPage() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  const m = MESSAGES[locale].colecoes

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.subtitulo}</p>
      </div>
      <SavedRecipesView />
    </Container>
  )
}
