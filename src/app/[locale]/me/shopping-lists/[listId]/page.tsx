/**
 * Página de UMA Lista de compras — check-off persistente (issue #529, ADR-0032 dec.6). Server
 * Component fino, espelha `/me/saved` e `/me/recipes`: provê o único `<main>` via
 * `<Container as="main">` + o `<h1>` localizado (genérico — o NOME da lista específica é exibido
 * pelo client, que já busca os itens), e monta `<ShoppingListItemsView />`, que resolve
 * sessão+locale e busca os itens no cliente (o fetch do browser leva o cookie de sessão
 * nativamente, então o dono lê sua própria lista privada).
 *
 * URL em inglês (CONTEXT.md/ADR-0032): /me/shopping-lists/[listId]. O TÍTULO precisa do locale
 * para o SSR bater com o client — resolvido como em `/me/saved`/`/me/recipes`: precedência
 * cookie → Accept-Language (sem `?locale`).
 */
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { ShoppingListItemsView } from '@/components/shopping-list/shopping-list-items-view'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

// Título fino ("Lista de compras") + noindex (só-logado), espelha #462.
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.listaDeCompras.titulo)
}

export default async function ShoppingListPage({
  params,
}: {
  params: Promise<{ listId: string }>
}) {
  const { listId } = await params
  const cookieStore = await cookies()
  const headerStore = await headers()
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  const m = MESSAGES[locale].listaDeCompras

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
        {m.titulo}
      </h1>
      <ShoppingListItemsView listId={listId} />
    </Container>
  )
}
