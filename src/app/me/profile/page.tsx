/**
 * Página "Seu perfil" (#124, frente Perfil — primeira fatia: nome + bio) — Server Component fino.
 * Espelha a tese de `/me/recipes`: shell fino que provê o ÚNICO `<main>` + o `<h1>` localizado, e
 * monta o `ProfileForm` (client) que resolve sessão e busca/grava `/api/me` no cliente (o fetch do
 * browser leva o cookie de sessão nativamente, então o dono lê/edita o PRÓPRIO perfil).
 *
 * URL em inglês (CONTEXT.md): /me/profile (espelha /me/recipes). O TÍTULO precisa do locale para o
 * SSR bater com o client — resolvido como nas outras pages: precedência `cookie → Accept-Language`.
 */
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { ProfileForm } from '@/components/profile/profile-form'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'

export default async function ProfilePage() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  const m = MESSAGES[locale].perfil

  return (
    <Container as="main" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.subtitulo}</p>
      </div>
      <ProfileForm />
    </Container>
  )
}
