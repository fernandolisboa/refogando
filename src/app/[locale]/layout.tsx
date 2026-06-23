import '../globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { LocaleProvider } from '@/i18n/provider'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { SUPPORTED_LOCALES, canonicalLocale } from '@/i18n/locale'
import { THEME_COOKIE, resolveThemeClass } from '@/lib/theme'

export const metadata: Metadata = {
  title: 'Refogando',
  description: 'App de receitas com IA, bilíngue pt-BR/en-US.',
}

// Locale-no-caminho (ADR-0020): o app inteiro vive sob `[locale]`, então este É o root layout
// (renderiza `<html>`/`<body>`) — não há `app/layout.tsx` acima. As duas variantes são
// pré-renderizadas; um locale fora do conjunto cai em `notFound()`.
export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }))
}

// Server Component: o `<html lang>` e o `initialLocale` do provider vêm AGORA do SEGMENTO DA
// URL (`params.locale`), não mais do cookie (ADR-0020 — a URL é a fonte da verdade do idioma
// exibido; o cookie só decide o redirect da raiz, no proxy). O `proxy.ts` garante que todo
// request chega prefixado e com case canônico; ainda assim validamos aqui (defesa em
// profundidade): locale desconhecido → 404, não tela quebrada.
export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale: rawLocale } = await params
  const locale = canonicalLocale(rawLocale)
  if (!locale) notFound()

  // Tema continua vindo do cookie (ADR-0018): não é uma dimensão da URL. Cookie
  // ausente/desconhecido → 'light' (padrão inicial, issue #208); 'dark' → a classe vence a
  // @media do SO. SSR sem flash. O ThemeToggle e o seletor de idioma (#162) vivem no FOOTER.
  const cookieStore = await cookies()
  const themeClass = resolveThemeClass(cookieStore.get(THEME_COOKIE)?.value)
  // `initialTheme` para o toggle (client): 'light'/'dark' explícito. SiteFooter é client,
  // então a preferência é threadada do servidor (sem ler cookie no client).
  const initialTheme = themeClass
  return (
    <html lang={locale} className={themeClass}>
      <body className="flex min-h-svh flex-col">
        <LocaleProvider initialLocale={locale}>
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
