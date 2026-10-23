/**
 * Home-Descoberta (#56/#236, ADR-0020) — "a Descoberta é a home". Server Component que server-renderiza
 * o FEED do POOL PÚBLICO em estado de REPOUSO (indexável) e monta o `<SearchExperience>` (client) que
 * provê o ÚNICO `<main>` do documento e refina INLINE a mesma superfície.
 *
 * DOIS contratos, deliberadamente separados (espelha o detalhe público #230):
 *
 *  1. REPOUSO / INDEXÁVEL: a 1ª página do feed vem do DB DIRETO e ANÔNIMO (`loadDiscoveryFeed`, viewer
 *     undefined) — SEM `cookies()`/`headers()`, SEM self-fetch. O pool é o MESMO do sitemap/detalhe
 *     (`eligibleForPublicRead`: catálogo/comunidade pública, não-`playful`, não-removida). Esse caminho
 *     fica cacheável e indexável; o crawler vê o feed no HTML (o client component é SSR-renderizado com
 *     `initialFeed`). NÃO server-renderiza feed personalizado-por-sessão (vazaria privadas + mataria cache).
 *
 *  2. REFINADO / NOINDEX: ao buscar/filtrar, o cliente assume a superfície e reflete o estado na URL
 *     (`?q=`/facetas). `generateMetadata` emite `noindex` pra QUALQUER param de refino — só o repouso
 *     indexa (ADR-0020). A home lê `searchParams` no `generateMetadata` ⇒ é DINÂMICA (HTML SSR pro
 *     crawler), mas o caminho de repouso NÃO toca cookie/sessão, então segue cacheável/indexável.
 *
 * `generateMetadata`/o feed usam `getBaseUrlFromEnv()` (env-only, sem `headers()`) ⇒ build-safe. Como a
 * home lê `searchParams`, ela é dinâmica e NÃO é pré-renderizada no build — o throw de prod-sem-APP_URL
 * de `getBaseUrlFromEnv` não dispara no build.
 *
 * "Receita da semana" (#457, ADR-0026): slot EDITORIAL fixo acima do feed, no MESMO caminho de
 * REPOUSO/indexável (`loadRecipeOfTheWeek`, DB direto, anônimo — sem cookie/sessão, espelha
 * `loadDiscoveryFeed`). Escolhida pelo Curador via `app_config` (`/admin/catalog`) ou, na ausência de
 * escolha (ou escolha que deixou de ser catálogo aprovado), pelo fallback automático de Popularidade.
 * Montada AQUI (server) e passada como `highlight` (ReactNode) pro `<SearchExperience>` client — que
 * a renderiza só no repouso, acima do `<DiscoveryFeed>`. `null` (catálogo aprovado vazio) ⇒ omite o
 * slot sem quebrar a home.
 *
 * Faixa para quem não entrou (#472): `HomeValueBanner` (client) vai no mesmo `highlight`, acima da receita da
 * semana, no HTML de todos (a frase é sorteada aqui, por requisição); some no navegador para quem está logado.
 */
import type { Metadata } from 'next'
import { SearchExperience } from '@/components/recipe/search-experience'
import { RecipeResultItem, type BadgeLabels } from '@/components/recipe/recipe-result-item'
import { HomeValueBanner } from '@/components/recipe/home-value-banner'
import { sortearFaixa } from '@/domain/faixa-home'
import { buildHomeMetadata, isRefinedHomeParams, type RawSearchParams } from '@/domain/discovery-home'
import { resolvePageLocale } from '@/server/http/page-locale'
import { getBaseUrlFromEnv } from '@/server/http/base-url'
import { loadDiscoveryFeed } from '@/server/recipe/feed'
import { loadRecipeOfTheWeek } from '@/server/recipe/recipe-of-week'
import { loadWebSearchConfig } from '@/server/app-config'
import { isWebSearchOpen } from '@/domain/web-search-config'
import { hasWebSearchCredential } from '@/server/web-search/web-search-provider'
import { getDb } from '@/server/deps'
import { MESSAGES } from '@/i18n/messages'
import { errorLogFields } from '@/domain/error-report'

/**
 * Metadados da home-Descoberta (#236): REPOUSO (sem param de refino) ⇒ index/follow + canonical
 * `/{locale}` + hreflang (todos os locales) + `x-default → /` (raiz redirecionadora, ADR-0020 dec.5) +
 * OG de marca; REFINADO (qualquer `q`/faceta/`sort`) ⇒ noindex/nofollow (o estado de busca não indexa).
 * Build-safe: `getBaseUrlFromEnv()` (env-only, sem `headers()`) ⇒ não força dinâmico no caminho de repouso.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<RawSearchParams>
}): Promise<Metadata> {
  const { locale: pathLocale } = await params
  const sp = await searchParams
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  const baseUrl = getBaseUrlFromEnv()
  const m = MESSAGES[locale]
  return buildHomeMetadata({
    locale,
    baseUrl,
    title: m.busca.titulo,
    description: m.app.tagline,
    brandName: m.app.name,
    refined: isRefinedHomeParams(sp),
  })
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>
  // `searchParams` é lido SÓ pelo `generateMetadata` (gate de índice). O render do feed de REPOUSO é
  // sempre o pool público anônimo — o refino é client-side e não muda o HTML SSR indexável.
  searchParams?: Promise<RawSearchParams>
}) {
  const { locale: pathLocale } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  const db = getDb()

  // Feed de REPOUSO: 1ª página ANÔNIMA do pool público (DB direto, SEM cookie ⇒ cacheável/indexável).
  // "Receita da semana" (#457): MESMO contrato (DB direto, anônimo) — as duas leituras rodam em
  // paralelo, nenhuma depende da outra.
  const [{ feed, nextCursor }, recipeOfWeek, webSearch] = await Promise.all([
    loadDiscoveryFeed(db, { requestLocale: locale }),
    loadRecipeOfTheWeek(db, locale),
    // Opcional: falha nesta leitura NÃO derruba a home — só esconde os gatilhos da web. No log, só nome e
    // código do erro (ADR-0048): o erro do Drizzle leva os parâmetros da query.
    loadWebSearchConfig(db).catch((err: unknown) => {
      console.warn(`[home] falha ao ler a config da descoberta na web; gatilhos escondidos: ${errorLogFields(err)}`)
      return null
    }),
  ])
  // Descoberta na web LIGADA de fato: flag admin + allowlist não vazia + chave do provedor (sem a chave o
  // provedor devolve `[]`). Desligada ⇒ a Busca esconde os gatilhos "Buscar na web" (beco sem saída).
  const webAvailable = webSearch !== null && isWebSearchOpen(webSearch) && hasWebSearchCredential()

  const m = MESSAGES[locale].busca
  const mw = MESSAGES[locale].receitaDaSemana
  const badgeLabels: BadgeLabels = { catalogo: m.seloCatalogo, comunidade: m.seloComunidade }

  const recipeOfWeekSlot =
    recipeOfWeek !== null ? (
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg">{mw.titulo}</h2>
        <p className="text-muted">{mw.subtitulo}</p>
        <ul className="flex flex-col">
          <RecipeResultItem
            recipeId={recipeOfWeek.recipeId}
            locale={locale}
            slug={recipeOfWeek.slug}
            displayedTitle={recipeOfWeek.displayedTitle}
            origin={recipeOfWeek.origin}
            autoTranslationSignal={recipeOfWeek.autoTranslationSignal}
            badgeLabels={badgeLabels}
            autoTranslationLabel={m.traducaoAutomatica}
            author={recipeOfWeek.author}
            byLabel={m.porAutor}
            imageUrl={recipeOfWeek.imageUrl}
            imageSrcSet={recipeOfWeek.imageSrcSet}
            imageAiGenerated={recipeOfWeek.imageAiGenerated}
            aiLabel={m.imagemSeloIa}
          />
        </ul>
      </div>
    ) : null

  // #472: a faixa para quem não entrou fica acima da "Receita da semana". Vai no HTML para todos (sem salto de
  // layout para o visitante) e some no navegador quando a sessão mostra uma conta. A frase é sorteada aqui, uma
  // vez por requisição (a home é dinâmica), e desce por prop para a hidratação pintar a mesma.
  const highlight = (
    <>
      <HomeValueBanner indice={sortearFaixa(MESSAGES[locale].faixaHome.titulos.length)} />
      {recipeOfWeekSlot}
    </>
  )

  return (
    <SearchExperience
      home
      initialFeed={feed}
      initialNextCursor={nextCursor}
      highlight={highlight}
      webAvailable={webAvailable}
    />
  )
}
