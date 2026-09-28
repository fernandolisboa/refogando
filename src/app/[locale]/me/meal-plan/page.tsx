/**
 * Página "Cardápio da semana" — Plano de refeições (ADR-0035). Server Component fino, espelha
 * `/me/saved`: provê o único `<main>` + o `<h1>` localizado e monta `<MealPlanWeekView />`, que
 * resolve sessão, o dia de HOJE (fuso do navegador, dec.2) e busca a semana no cliente.
 *
 * URL em inglês (CONTEXT.md): /me/meal-plan[?semana=YYYY-MM-DD]. Largura `page` (não `reading`): a
 * semana é uma grade de dias. `<Suspense>` é obrigatório — a vista lê `useSearchParams` (`?semana`).
 */
import { Suspense } from 'react'
import { cookies, headers } from 'next/headers'
import { Container } from '@/components/container'
import { MealPlanWeekView } from '@/components/meal-plan/meal-plan-week-view'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { resolvePageLocale } from '@/server/http/page-locale'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

// Título fino ("Cardápio da semana") + noindex (só-logado), espelha #462.
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.cardapio.titulo)
}

export default async function MealPlanPage() {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const locale = resolvePageLocale({
    urlLocale: null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  const m = MESSAGES[locale].cardapio

  return (
    <Container as="main" size="page" className="flex flex-col gap-8 py-8 sm:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {m.titulo}
        </h1>
        <p className="text-muted">{m.descricao}</p>
      </div>
      <Suspense fallback={<p className="text-muted">{MESSAGES[locale].system.loading}</p>}>
        <MealPlanWeekView />
      </Suspense>
    </Container>
  )
}
