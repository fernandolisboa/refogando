import '../globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { RecipeVariantProvider } from '@/components/recipe/recipe-variant-provider'
import { HomeSearchProvider } from '@/components/recipe/home-search-context'
import { RestricoesPerfilProvider } from '@/components/profile/restricoes-perfil-provider'
import { AppUpdateGuard } from '@/components/app-update-guard'
import { ThemeCookieSync } from '@/components/theme-cookie-sync'
import { SiteHeader } from '@/components/site-header'
import { SectionTabs } from '@/components/nav/section-tabs'
import { SiteFooter } from '@/components/site-footer'
import { GuidedTour } from '@/components/onboarding/guided-tour'
import { AccountNotice } from '@/components/profile/account-notice'
import { SUPPORTED_LOCALES, canonicalLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { DEFAULT_THEME_CLASS } from '@/lib/theme'
import { THEME_INIT_SCRIPT } from '@/lib/theme-script'
import { getDb } from '@/server/deps'
import { loadLayoutAppConfig, loadLayoutCozinhaVocab, type LayoutAppConfig } from '@/server/layout-data'
import { localizeCozinhaVocab, type CozinhaOption } from '@/domain/cozinha-label'

export const metadata: Metadata = {
  title: 'Refogando',
  description: 'App de receitas com IA.',
}

// Locale-no-caminho (ADR-0020): o app inteiro vive sob `[locale]`, então este É o root layout
// (renderiza `<html>`/`<body>`) — não há `app/layout.tsx` acima. As duas variantes são
// pré-renderizadas; um locale fora do conjunto cai em `notFound()`.
//
// Rota nova embaixo de `[locale]` entra no grupo `(com-carregamento)/`, que tem o `loading.tsx`. Fora dele
// fica só o que precisa de status HTTP real (308/404), hoje `recipes/` e `u/` (ver o `loading.tsx` do grupo).
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

  // Tema (ADR-0018): o cookie `theme` segue sendo a fonte da verdade, mas o layout NÃO o lê mais
  // (`cookies()` tornava TODA rota dinâmica — achado A da auditoria de performance). O HTML sai com
  // `DEFAULT_THEME_CLASS` ('light', o mesmo de quem não tem cookie, issue #208) e o script inline do
  // `<head>` troca a classe pela do cookie antes da primeira pintura: sem flash, e o mesmo HTML serve
  // a todos. `suppressHydrationWarning` no `<html>` porque a classe pode diferir da do servidor quando
  // o React hidrata (só aquele elemento, não os filhos). O ThemeToggle e o seletor de idioma (#162)
  // vivem no FOOTER; o toggle lê o tema do `<html>`.

  // Vocabulário de cozinha (#317, ADR-0025): resolvido UMA vez no ancestral comum de TODA
  // rota e semeado no contexto (escopo `active` — só termos vivos viram opção em forms). Vem do Data
  // Cache com tag (`loadLayoutCozinhaVocab`, invalidado pelas rotas de admin/curadoria que mudam o
  // escopo `active`). Como ESTE layout é a raiz de cada página, um erro do leitor (soluço do Neon) NÃO
  // pode derrubar sign-in/erro/estáticas — degrada p/ `[]` (a faceta de cozinha some, o resto segue).
  //
  // `connection()` na degradação: a página degradada NÃO pode virar HTML estático/ISR (ficaria sem
  // cozinhas até a próxima revalidação). No pré-render (build ou regeneração ISR) ele marca a rota como
  // dinâmica e aborta aquele pré-render; num request já dinâmico não faz nada, e a degradação é a de
  // sempre. No build sem banco (CI) as rotas simplesmente saem dinâmicas, como antes. Numa regeneração
  // ISR só chega aqui quem não tem entrada nenhuma no Data Cache: com uma entrada vencida (por tempo ou
  // pela tag, perfil `'max'`), o `unstable_cache` devolve o valor antigo quando o banco falha.
  //
  // As duas leituras são independentes e rodam em paralelo, cada uma com a sua degradação (`null` =
  // falhou; o `try` dentro de cada `async` pega também o `getDb()` que lança sem `DATABASE_URL`, como no
  // build da CI).
  const [vocabRead, configRead] = await Promise.all([
    (async (): Promise<CozinhaOption[] | null> => {
      try {
        return localizeCozinhaVocab(await loadLayoutCozinhaVocab(getDb()), locale)
      } catch {
        return null
      }
    })(),
    // #423 + #451: do app_config o layout só usa o liga/desliga do "gerar 2" e os links sociais do footer
    // (já filtrados por `enabled` no servidor — o footer, client, só recebe o que renderiza; link
    // desligado não vaza no HTML). Data Cache com tag (`loadLayoutAppConfig`, invalidado no PUT de
    // `/api/admin/config`). Mesmo tratamento gracioso da cozinha: soluço do Neon ⇒ variar2 desligado +
    // footer sem links (degrada, nunca tela quebrada). O servidor revalida `variar2` de qualquer forma.
    (async (): Promise<LayoutAppConfig | null> => {
      try {
        return await loadLayoutAppConfig(getDb())
      } catch {
        return null
      }
    })(),
  ])
  if (vocabRead === null || configRead === null) await connection()
  const cozinhaVocab = vocabRead ?? []
  const { variantEnabled, socialLinks } = configRead ?? { variantEnabled: false, socialLinks: [] }

  return (
    <html lang={locale} className={DEFAULT_THEME_CLASS} suppressHydrationWarning>
      <head>
        {/* Tema antes da primeira pintura (ver `THEME_INIT_SCRIPT` em src/lib/theme-script.ts). Inline e
            síncrono de propósito: um `next/script` rodaria depois da pintura. A CSP permite
            (`script-src 'unsafe-inline'`, next.config.ts). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
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
        {/* Reaplica o tema do cookie quando o React monta o `<html>` no client sem o script do `<head>` ter
            rodado (404/500 da página da receita, erro de hidratação). Sem DOM; no caminho normal é no-op. */}
        <ThemeCookieSync />
        <LocaleProvider initialLocale={locale}>
          <CozinhaVocabProvider value={cozinhaVocab}>
           <RecipeVariantProvider enabled={variantEnabled}>
            {/* ADR-0041: Restrições alimentares salvas no perfil — default pré-marcado na criação, na Sugestão
                de cardápio e na Busca. Client, carga preguiçosa (só busca quando uma superfície pede). */}
            <RestricoesPerfilProvider>
            {/* #5 (protótipo final): o termo de busca (`q`) é ELEVADO aqui pra que a pílula viva
                DENTRO do SiteHeader (linha 2, só na home) enquanto o cérebro da Busca segue em
                SearchExperience (que é IRMÃO do header). `children` passa como PROP por este client
                component ⇒ a página (server) e o feed SSR-seedado (indexável, ADR-0020) continuam
                renderizados no servidor. O resto do estado da Busca NÃO sobe — só o `q`. */}
            <HomeSearchProvider>
              <SiteHeader />
              {/* ADR-0043: subabas da seção atual (Explorar, Minhas receitas, Planejar), fora do header
                  sticky; nada fora das seções. */}
              <SectionTabs />
              {/* #595: depois da recarga da saída do diálogo de exclusão, "Sua conta foi excluída." ou a sessão
                  expirada (sinal no sessionStorage). */}
              <AccountNotice />
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
              <SiteFooter socialLinks={socialLinks} />
              {/* Tour guiado (ADR-0039): sem DOM até abrir; abre só na home (conta nova ou pedido do /guia). */}
              <GuidedTour />
            </HomeSearchProvider>
            </RestricoesPerfilProvider>
           </RecipeVariantProvider>
          </CozinhaVocabProvider>
        </LocaleProvider>
      </body>
    </html>
  )
}
