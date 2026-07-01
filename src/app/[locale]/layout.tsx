import '../globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { AppUpdateGuard } from '@/components/app-update-guard'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { SUPPORTED_LOCALES, canonicalLocale } from '@/i18n/locale'
import { THEME_COOKIE, resolveThemeClass } from '@/lib/theme'
import { getDb } from '@/server/deps'
import { loadVocabulary } from '@/server/vocabulary/load'
import { localizeCozinhaVocab, type CozinhaOption } from '@/domain/cozinha-label'

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

  // Vocabulário de cozinha (#317, ADR-0025): resolvido UMA vez no ancestral comum de TODA
  // rota e semeado no contexto (escopo `active` — só termos vivos viram opção em forms). O
  // leitor tem cache de 30s por instância, então o roundtrip extra é amortizado. Como ESTE
  // layout é a raiz de cada página, um erro do leitor (soluço do Neon) NÃO pode derrubar
  // sign-in/erro/estáticas — degrada p/ `[]` (a faceta de cozinha some, o resto segue).
  let cozinhaVocab: CozinhaOption[] = []
  try {
    cozinhaVocab = localizeCozinhaVocab(await loadVocabulary(getDb(), 'cozinha', 'active'), locale)
  } catch {
    cozinhaVocab = []
  }
  return (
    <html lang={locale} className={themeClass}>
      <body className="flex min-h-svh flex-col">
        {/* Atualização graceful (#372, ADR-0028 dec 5-A2): rede de segurança silenciosa, sem DOM
            (retorna null), independente de provider/locale/sessão. Montado incondicionalmente ⇒
            o visitante anônimo também se beneficia do reload quieto pós-deploy. */}
        <AppUpdateGuard />
        <LocaleProvider initialLocale={locale}>
          <CozinhaVocabProvider value={cozinhaVocab}>
            {/* #5 (protótipo final): o termo de busca (`q`) é ELEVADO aqui pra que a pílula viva
                DENTRO do SiteHeader (linha 2, só na home) enquanto o cérebro da Busca segue em
                SearchExperience (que é IRMÃO do header). `children` passa como PROP por este client
                component ⇒ a página (server) e o feed SSR-seedado (indexável, ADR-0020) continuam
                renderizados no servidor. O resto do estado da Busca NÃO sobe — só o `q`. */}
            <HomeSearchProvider>
              <SiteHeader />
              {/* Wrapper flex-1 (não <main>): cada página rende o seu próprio <main>,
                  então mantém um único landmark main por documento. */}
              <div className="flex flex-1 flex-col">{children}</div>
              <SiteFooter initialTheme={initialTheme} />
            </HomeSearchProvider>
          </CozinhaVocabProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
