/**
 * Página "Minhas criações" (#61) — Server Component fino. Provê o ÚNICO `<main>` do documento
 * via `<Container as="main">` + o `<h1>` localizado (que NÃO vive no client list — assim o
 * estado vazio/lista/guest do client nunca precisa emitir outro `<h1>`). Monta o `MyRecipesList`,
 * que resolve sessão+locale e busca `GET /api/me/recipes` no cliente (o fetch do browser leva
 * o cookie de sessão nativamente, então o dono lê as próprias Receitas privadas).
 *
 * URL em inglês (CONTEXT.md): /me/recipes. Espelha a tese de `create`/`conversation` (shell
 * fino + guard de sessão no client); NÃO faz fetch server-side (o client list o faz, com
 * AbortController/locale tracking que são concerns de client).
 *
 * O TÍTULO precisa do locale para o SSR bater com o client — resolvido como nas pages de
 * detalhe: precedência `cookie → Accept-Language` (sem `?locale` aqui; a página não tem query).
 */
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { MyRecipesList } from '@/components/recipe/my-recipes-list'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

// #462: título fino ("Minhas criações") + noindex (só-logado).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.minhasCriacoes.titulo)
}

export default async function MyRecipesPage() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  const m = MESSAGES[locale].minhasCriacoes

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.subtitulo}</p>
      </div>
      <MyRecipesList />
    </Container>
  )
}
