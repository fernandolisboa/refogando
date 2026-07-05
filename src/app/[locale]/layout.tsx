import '../globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { RecipeVariantProvider } from '@/components/recipe/recipe-variant-provider'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { AppUpdateGuard } from '@/components/app-update-guard'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'
import { SUPPORTED_LOCALES, canonicalLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { THEME_COOKIE, resolveThemeClass } from '@/lib/theme'
import { getDb } from '@/server/deps'
import { loadVocabulary } from '@/server/vocabulary/load'
import { localizeCozinhaVocab, type CozinhaOption } from '@/domain/cozinha-label'
import { loadAppConfig } from '@/server/app-config'
import type { SocialLink } from '@/domain/social-links-config'

export const metadata: Metadata = {
  title: 'Refogando',
  description: 'App de receitas com IA.',
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

  // #423: a feature "gerar 2, o usuário escolhe" está ligada? Semeado no contexto (o opt-in aparece só
  // com a config ligada). Mesmo tratamento gracioso da cozinha — um soluço do Neon vira `false` (a
  // feature some), nunca uma tela quebrada. O servidor revalida `variar2` de qualquer forma.
  // #423 + #451: uma ÚNICA leitura de app_config por request (mesma linha singleton) — a feature
  // "gerar 2" está ligada? e os links sociais do footer. Mesmo tratamento gracioso da cozinha: soluço
  // do Neon ⇒ variar2 desligado + footer sem links (degrada, nunca tela quebrada). Filtramos os links
  // habilitados NO SERVIDOR — o footer (client) só recebe o que renderiza (payload menor; link
  // desligado não vaza no HTML).
  let variantEnabled = false
  let socialLinks: SocialLink[] = []
  try {
    const cfg = await loadAppConfig(getDb())
    variantEnabled = cfg.recipeVariant.enabled
    socialLinks = cfg.socialLinks.filter((l) => l.enabled)
  } catch {
    variantEnabled = false
    socialLinks = []
  }
  return (
    <html lang={locale} className={themeClass}>
      <body className="flex min-h-svh flex-col">
        {/* #461 (a11y): skip-link — PRIMEIRO tab stop do documento, oculto acima da viewport até
            receber foco (então desliza pra `top-2`), pulando os ~7 tab stops repetidos do header
            sticky direto pro conteúdo (`#conteudo`, o wrapper do `<main>` da página). Server-render
            no locale do segmento da URL (`MESSAGES[locale]`) — não depende de provider/cliente. */}
        <a
          href="#conteudo"
          className="absolute left-4 -top-16 z-[100] rounded-md bg-surface px-4 py-2 text-sm font-medium text-fg shadow-md ring-2 ring-brand transition-[top] focus:top-2"
        >
          {MESSAGES[locale].nav.pularParaConteudo}
        </a>
        {/* Atualização graceful (#372, ADR-0028 dec 5-A2): rede de segurança silenciosa, sem DOM
            (retorna null), independente de provider/locale/sessão. Montado incondicionalmente ⇒
            o visitante anônimo também se beneficia do reload quieto pós-deploy. */}
        <AppUpdateGuard />
        <LocaleProvider initialLocale={locale}>
          <CozinhaVocabProvider value={cozinhaVocab}>
           <RecipeVariantProvider enabled={variantEnabled}>
            {/* #5 (protótipo final): o termo de busca (`q`) é ELEVADO aqui pra que a pílula viva
                DENTRO do SiteHeader (linha 2, só na home) enquanto o cérebro da Busca segue em
                SearchExperience (que é IRMÃO do header). `children` passa como PROP por este client
                component ⇒ a página (server) e o feed SSR-seedado (indexável, ADR-0020) continuam
                renderizados no servidor. O resto do estado da Busca NÃO sobe — só o `q`. */}
            <HomeSearchProvider>
              <SiteHeader />
              {/* Wrapper flex-1 (não <main>): cada página rende o seu próprio <main>,
                  então mantém um único landmark main por documento. #461: alvo do skip-link
                  (`id="conteudo"` + `tabIndex={-1}` p/ receber foco programático sem virar tab stop). */}
              <div
                id="conteudo"
                tabIndex={-1}
                className="flex flex-1 flex-col rounded-sm outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-bg"
              >
                {children}
              </div>
              <SiteFooter initialTheme={initialTheme} socialLinks={socialLinks} />
            </HomeSearchProvider>
           </RecipeVariantProvider>
          </CozinhaVocabProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
