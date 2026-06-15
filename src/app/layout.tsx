import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies, headers } from 'next/headers'
import { LocaleProvider } from '@/i18n/provider'
import { LocaleSwitcher } from '@/i18n/locale-switcher'
import { resolveLocale } from '@/i18n/locale'
import { LOCALE_COOKIE } from '@/i18n/cookie'

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
  return (
    <html lang={initialLocale}>
      <body>
        <LocaleProvider initialLocale={initialLocale}>
          <header>
            <LocaleSwitcher />
          </header>
          {children}
        </LocaleProvider>
      </body>
    </html>
  )
}
