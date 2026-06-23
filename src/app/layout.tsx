import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { LocaleProvider } from '@/i18n/provider'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { resolveLocale } from '@/i18n/locale'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { THEME_COOKIE, resolveThemeClass } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Refogando',
  description: 'App de receitas com IA, bilíngue pt-BR/en-US.',
}

// Server Component: resolve o locale no servidor (cookie do Visitante → Accept-Language)
// e passa como `initialLocale` ao provider client. Assim o render do servidor e o primeiro
// render do client batem (sem hydration mismatch) e `<html lang>` é o locale real, não um
// pt-BR estático. A chrome client é a que troca de idioma em runtime (#4.AC1).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies()
  const headerStore = await headers()
  const initialLocale = resolveLocale({
    preferred: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })
  // Tema do mesmo cookieStore (ADR-0018): cookie ausente/desconhecido → 'light' (padrão
  // inicial, issue #208); 'dark' → a classe vence a @media do SO. SSR sem flash, igual ao
  // locale. O ThemeToggle e o seletor de idioma (#162) vivem no FOOTER (o header fica só
  // com [wordmark, nav, conta]); o footer recebe `initialTheme` do mesmo cookie.
  const themeClass = resolveThemeClass(cookieStore.get(THEME_COOKIE)?.value)
  // `initialTheme` para o toggle (client): 'light'/'dark' explícito (nunca vazio agora, então
  // nunca segue o SO por omissão — o usuário ainda alterna pra 'dark' a partir do claro).
  // SiteFooter é client, então a preferência é threadada do servidor (sem ler cookie no client).
  const initialTheme = themeClass
  return (
    <html lang={initialLocale} className={themeClass}>
      <body className="flex min-h-svh flex-col">
        <LocaleProvider initialLocale={initialLocale}>
          <SiteHeader />
          {/* Wrapper flex-1 (não <main>): cada página rende o seu próprio <main>,
              então mantém um único landmark main por documento. */}
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter initialTheme={initialTheme} />
        </LocaleProvider>
      </body>
    </html>
  )
}
