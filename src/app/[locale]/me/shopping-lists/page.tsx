/**
 * Página "Lista de compras" (#528, ADR-0032 dec.5) — Server Component fino, espelha `/me/saved`.
 * Provê o único `<main>` via `<Container as="main">` + o `<h1>` localizado (o client não emite
 * outro `<h1>`), e monta o `<ShoppingListView />`, que resolve sessão+locale, garante a lista-
 * padrão (dec.1) e busca/edita os itens no cliente.
 *
 * URL em inglês (CONTEXT.md/ADR-0020, como /me/saved): /me/shopping-lists. O TÍTULO precisa do
 * locale para o SSR bater com o client — resolvido como nas demais páginas `/me/*`: precedência
 * cookie → Accept-Language (sem `?locale`).
 */
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { ShoppingListView } from '@/components/recipe/shopping-list-view'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.listaCompras.titulo)
}

export default async function ShoppingListsPage() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  const m = MESSAGES[locale].listaCompras

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.subtitulo}</p>
      </div>
      <ShoppingListView />
    </Container>
  )
}
