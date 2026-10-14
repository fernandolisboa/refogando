/**
 * Índice das Listas de compras (ADR-0035 Consequências; listas do ADR-0032). Server Component fino,
 * espelha `/me/saved`: o único `<main>` + o `<h1>` localizado, e `<ShoppingListsIndex />` busca as
 * listas no cliente (o fetch leva o cookie de sessão). URL em inglês: /me/shopping-lists.
 */
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { ShoppingListsIndex } from '@/components/shopping-list/shopping-lists-index'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

// Título fino ("Listas de compras") + noindex (só-logado), espelha #462.
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.listaDeCompras.indiceTitulo)
}

export default async function ShoppingListsPage() {
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
        {m.indiceTitulo}
      </h1>
      <ShoppingListsIndex />
    </Container>
  )
}
