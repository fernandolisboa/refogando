/**
 * Página de detalhe da Receita (#57, #230) — Server Component. URL canônica = SLUG per-locale
 * (`/{locale}/recipes/<slug>`, ADR-0020 decisão 4). O segmento dinâmico `[id]` carrega OU um slug
 * OU (links antigos / bookmark do dono) o UUID interno.
 *
 * DOIS caminhos de leitura, deliberadamente separados (ADR-0020 — "leitura indexável anônima e
 * cacheável, separada da leitura do dono"):
 *
 *  1. PÚBLICO/INDEXÁVEL (slug): `loadPublicRecipeBySlug` lê do DB DIRETO, ANÔNIMO e CACHEÁVEL —
 *     SEM cookie/sessão, SEM self-fetch com `no-store`, SEM forçar render dinâmico, SEM
 *     personalizar pro crawler. Aplica o gate de leitura pública (= gate de indexação default-open:
 *     comunidade/Catálogo E não-`playful` E não-removida). Achou ⇒ renderiza a view só-leitura e
 *     termina SEM tocar cookies (a rota fica estaticamente renderizável/cacheável). É o caminho
 *     quente do Google e de qualquer anônimo. `RecipeDetailActions` é client component
 *     (`useSession`) ⇒ a afordância "Criar minha versão"/convite resolve no cliente sem cookie.
 *
 *  2. DONO (privado/dinâmico): quando o caminho 1 devolve `null` (Receita privada/playful/removida
 *     OU slug inexistente), OU quando o `[id]` é um UUID legado que NÃO 308-ou (= a Receita não é
 *     leitura pública: sem slug público), caímos no caminho do dono — `?original` legado + self-fetch
 *     `/api/recipes/[id]` com cookie de sessão (a rota reimpõe ownership e devolve 404 leak-safe a
 *     quem não é dono). Esse caminho é dinâmico por natureza (lê cookie) e PRESERVA o fluxo de
 *     leitura+edição do dono do rework Criar/Editar — mas NÃO contamina o caminho 1.
 *
 * Canonicalização UUID→slug (permanente): mora AQUI, no Server Component. Um `[id]` com forma de
 * UUID legado resolve o slug PÚBLICO (gateado por `resolvePublicSlugForLocale`) do locale e dá um
 * `permanentRedirect` — o redirect PERMANENTE idiomático de Server Component, que o Next 16 emite
 * como **308** (equivalente ao 301 do ADR p/ SEO: permanente, cacheável, consolida link equity). O
 * gate é LEAK-SAFE: só Receitas de leitura pública 308-am; um UUID NÃO-público (privado/playful/
 * removido/sem-slug) NÃO redireciona — cai no caminho do dono (2), que devolve 404 leak-safe a quem
 * não é dono. Assim NÃO se vaza o slug (derivado do título) nem a existência de Receita privada.
 * Manter o gate+redirect AQUI (não no proxy) honra o ADR ("leitura/gate no server component") e
 * mantém o proxy header-only (sem DB no caminho quente de toda navegação).
 */
import { cache } from 'react'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/container'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
import { RecipeImageManager } from '@/components/recipe/recipe-image-manager'
import { RecipeDetailActions } from '@/components/recipe/recipe-detail-actions'
import { RecipeEngagementControls } from '@/components/recipe/recipe-engagement-controls'
import { RecipeStatusChip } from '@/components/recipe/recipe-status-chip'
import type { RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import { decideRecipeDetailRoute, recipeDetailPath } from '@/domain/recipe-detail-route'
import { buildRecipeMetadata, buildRecipeJsonLd, serializeJsonLd } from '@/domain/recipe-seo'
import type { Locale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { getDb } from '@/server/deps'
import {
  loadPublicRecipeBySlug,
  loadSocialState,
  resolvePublicSlugForLocale,
  resolveRecipeIdBySlug,
} from '@/server/recipe/load'
import { buildRecipeSeoInputFromRows, loadRecipeSlugMap } from '@/server/recipe/seo'
import { getBaseUrl, getBaseUrlFromEnv } from '@/server/http/base-url'
import { handleResponse } from '@/server/http/handle-response'
import { resolvePageLocale, resolveContentLocale } from '@/server/http/page-locale'

/**
 * Dedup por-request (React.cache) das DUAS leituras públicas que `generateMetadata` E o render fazem
 * pelo MESMO (slug, locale)/recipeId no mesmo request — o Next não dedup raw DB sozinho. `cache()`
 * memoiza por argumentos no escopo do request: a 2ª chamada (render, depois do metadata) reusa o
 * resultado em vez de bater o banco de novo. Build-safe: nenhuma das duas toca `headers()`/`cookies()`,
 * então a memoização NÃO contamina a cacheabilidade do caminho público.
 */
const loadPublicRecipeBySlugCached = cache(loadPublicRecipeBySlug)
const loadRecipeSlugMapCached = cache(loadRecipeSlugMap)

/**
 * Metadados indexáveis do detalhe (#232 OG, #233 canonical/hreflang/x-default/robots, #234 alimenta
 * o JSON-LD via o mesmo input) — `generateMetadata` da MESMA rota do render. CACHEÁVEL por design:
 * NÃO toca `headers()`/`cookies()` (usa `getBaseUrlFromEnv`, env-only) e lê SÓ pelo caminho PÚBLICO
 * por slug (`loadPublicRecipeBySlug`, anônimo). Assim a página indexável NÃO vira dinâmica.
 *
 * Dois desfechos, espelhando o render:
 *  - SLUG público elegível ⇒ metadados completos (OG/canonical/hreflang/robots index,follow).
 *  - Qualquer outra coisa (UUID legado, slug privado/inexistente = caminho do DONO/dinâmico) ⇒
 *    `noindex` (não vaza nem indexa o caminho do dono). NUNCA toca cookie aqui.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale: pathLocale, id } = await params
  const locale = resolvePageLocale({ urlLocale: pathLocale })
  const baseUrl = getBaseUrlFromEnv() // build-safe (env-only, SEM headers) ⇒ mantém cacheável.

  const route = decideRecipeDetailRoute(id)
  if (route.kind === 'slug') {
    const rows = await loadPublicRecipeBySlugCached(getDb(), route.slug, locale)
    if (rows != null) {
      const slugMap = await loadRecipeSlugMapCached(getDb(), rows.recipe.id)
      const input = buildRecipeSeoInputFromRows({ rows, locale, baseUrl, slugMap, eligible: true })
      return buildRecipeMetadata(input)
    }
  }
  // Caminho do dono/privado/UUID legado: NÃO indexar (default-open só vale pro caminho público).
  // metadataBase mesmo assim (links absolutos consistentes), sem canonical/OG de conteúdo privado.
  return {
    metadataBase: new URL(baseUrl),
    robots: { index: false, follow: false },
  }
}

export default async function RecipeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ original?: string; reviewImage?: string }>
}) {
  const { locale: pathLocale, id } = await params

  // Locale da CHROME = SEGMENTO da URL (ADR-0020/#228). Resolvido SEM cookie no caminho público: o
  // path é a fonte da verdade e o proxy garante o prefixo canônico; cookie/Accept-Language só
  // entram como rede de segurança no caminho do dono (que já é dinâmico).
  const locale = resolvePageLocale({ urlLocale: pathLocale })

  // Decisão PURA de forma do param: UUID legado (resolver slug + 308) vs slug (público + fallback dono).
  const route = decideRecipeDetailRoute(id)

  // ── UUID legado: resolve o slug PÚBLICO (gateado) e dá um permanentRedirect (308) pro canônico ──
  // Leak-safe: `resolvePublicSlugForLocale` aplica o gate de leitura pública (= índice). Receita
  // pública com slug ⇒ 308 pro slug (canonicalização permanente, ADR-0020 decisão 4). NÃO-pública
  // (privada/playful/removida) ou sem slug ⇒ slug NULL ⇒ NÃO redireciona: cai no caminho do DONO
  // abaixo (cookie, 404 leak-safe), sem vazar o slug (derivado do título) nem a existência.
  if (route.kind === 'redirect-uuid') {
    const slug = await resolvePublicSlugForLocale(getDb(), route.uuid, locale)
    // permanentRedirect (308) NÃO retorna — lança e encerra o render. SÓ para UUIDs públicos.
    if (slug != null) permanentRedirect(recipeDetailPath(locale, slug))
    // slug == null ⇒ não-público/sem-slug: segue pro caminho do dono (usa o uuid direto). NÃO 404
    // aqui (o dono ainda precisa ler a própria privada por uuid legado/bookmark).
  }

  // ── PÚBLICO por slug: leitura ANÔNIMA e CACHEÁVEL via DB direto (NÃO toca cookie/sessão) ─────
  // SÓ quando o `[id]` é um slug (não um UUID): o UUID público já foi 308-ado acima, então um
  // UUID que chega adiante é NÃO-público e vai direto pro caminho do dono (não paga a query pública).
  if (route.kind === 'slug') {
    const publicRows = await loadPublicRecipeBySlugCached(getDb(), route.slug, locale)
    if (publicRows != null) {
      // Contagem de votos: agregado PÚBLICO de pool — anônimo, sem cookie (não personaliza nem força
      // dinâmico). `viewerVoted`/`viewerFavorited` ficam AUSENTES (anônimo) — o estado do viewer é
      // resolvido no cliente pelos controles quando logado. Mantém a rota cacheável.
      const social = await loadSocialState(getDb(), {
        id: publicRows.recipe.id,
        includeVoteCount: true,
      })
      const view = resolveRecipeView({
        recipe: publicRows.recipe,
        translations: publicRows.translations,
        ingredients: publicRows.ingredients,
        tags: publicRows.tags,
        requestLocale: locale,
        voteCount: social.voteCount,
        ...(publicRows.author ? { author: publicRows.author } : {}),
        ...(publicRows.imageUrl ? { imageUrl: publicRows.imageUrl } : {}),
        ...(publicRows.imageAiGenerated ? { imageAiGenerated: publicRows.imageAiGenerated } : {}),
        ...(publicRows.imageModerated ? { imageModerated: publicRows.imageModerated } : {}),
      })
      // JSON-LD Recipe (#234): emitido SÓ no caminho PÚBLICO/indexável (a Receita elegível chegou
      // aqui). Mesmo input dos metadados; base build-safe (env, sem headers ⇒ não força dinâmico).
      const slugMap = await loadRecipeSlugMapCached(getDb(), publicRows.recipe.id)
      const seoInput = buildRecipeSeoInputFromRows({
        rows: publicRows,
        locale,
        baseUrl: getBaseUrlFromEnv(),
        slugMap,
        eligible: true,
      })
      const jsonLd = serializeJsonLd(buildRecipeJsonLd(seoInput))
      return <DetailChrome view={view} locale={locale} reviewImage={false} jsonLd={jsonLd} />
    }
  }

  // ── DONO/privado: caminho DINÂMICO (cookie). Chega aqui quando:
  //    (a) o `[id]` é um SLUG cuja leitura pública deu null (privada/playful/removida/inexistente), OU
  //    (b) o `[id]` é um UUID legado que NÃO 308-ou acima (= não é leitura pública: sem slug público).
  //    Reusa a rota /api/recipes/[id] que reimpõe ownership e devolve 404 leak-safe a quem não é
  //    dono — preserva o fluxo leitura+edição do dono. NUNCA redireciona nem revela slug aqui.
  const sp = await searchParams
  // `headers()` (lido para encaminhar o cookie de sessão abaixo) já marca ESTE branch como
  // DINÂMICO (correto — leitura do dono), sem afetar o branch público acima (que retornou sem
  // tocar `headers()`/`cookies()`, ficando estaticamente renderizável/cacheável).
  const headerStore = await headers()

  // Resolve o UUID interno (chave da API de dados): se o `[id]` JÁ é um UUID legado, usa-o direto;
  // se é um SLUG (link interno do dono), acha a Receita pelo slug — INCLUSIVE privada do dono, então
  // a busca NÃO aplica o gate público. Sem casamento ⇒ 404 leak-safe.
  const ownerUuid =
    route.kind === 'redirect-uuid'
      ? route.uuid
      : await resolveRecipeIdBySlug(getDb(), route.slug, locale)
  if (ownerUuid == null) notFound()

  const contentLocale = resolveContentLocale({ pageLocale: locale, original: sp.original })
  const base = await getBaseUrl()
  const url = `${base}/api/recipes/${encodeURIComponent(ownerUuid)}?locale=${encodeURIComponent(contentLocale)}`
  // Encaminha o cookie de sessão: sem isto a rota vê requisição anônima e o dono nunca lê a própria
  // privada. `no-store` permanece (resposta dependente de sessão nunca é cacheável).
  const cookieHeader = headerStore.get('cookie')
  const res = await fetch(url, {
    cache: 'no-store',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })

  const outcome = handleResponse(res)
  if (outcome.kind === 'notFound') notFound()
  if (outcome.kind === 'error') {
    throw new Error(`Falha ao carregar a receita: ${outcome.status}`)
  }

  const view = (await res.json()) as RecipeView
  return <DetailChrome view={view} locale={locale} reviewImage={sp.reviewImage === '1'} />
}

/**
 * Chrome compartilhada do detalhe — a MESMA tela só-leitura para o caminho público e o do dono. Os
 * controles de gestão (status/imagem) já são gateados por `view.canManage` (presente SÓ pro dono,
 * AUSENTE no caminho público): a vista pública nunca os renderiza. `RecipeEngagementControls`
 * gateia por `voteCount != null` (presente no pool); `RecipeDetailActions` (client) resolve a
 * afordância dono/não-dono/visitante pela sessão do cliente.
 */
function DetailChrome({
  view,
  locale,
  reviewImage,
  jsonLd,
}: {
  view: RecipeView
  locale: Locale
  reviewImage: boolean
  /**
   * JSON-LD `schema.org/Recipe` JÁ serializado (#234) — presente SÓ no caminho PÚBLICO/indexável
   * (ausente no caminho do dono/dinâmico: receita privada não vai pro grafo). Renderizado como
   * `<script type="application/ld+json">` no corpo (forma idiomática do Next 16 — entrega o JSON-LD
   * no HTML pro crawler). String segura (o `<` já foi escapado em `serializeJsonLd`).
   */
  jsonLd?: string
}) {
  const messages = MESSAGES[locale]
  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      {/* JSON-LD Recipe (#234): só no caminho público. `dangerouslySetInnerHTML` é a forma idiomática
          de embutir JSON-LD; a string já vem com `<`→`<` (anti-XSS de `</script>`). */}
      {jsonLd != null && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      )}
      {/* Voltar à busca: primeiro elemento, muted; href estável "/" (a home É a busca). */}
      <Link href="/" className="text-sm text-muted transition-colors hover:text-fg">
        ← {messages.detalhe.voltarBusca}
      </Link>
      <RecipeDetailView view={view} m={messages} />
      {/* Engajamento (#62): gate pela presença do agregado de pool (`voteCount`). No caminho público
          o anônimo VÊ a contagem; `viewerVoted`/`viewerFavorited` ausentes (resolvidos no cliente). */}
      {view.voteCount != null && (
        <RecipeEngagementControls
          recipeId={view.id}
          initialVoteCount={view.voteCount}
          initialViewerVoted={view.viewerVoted}
          initialViewerFavorited={view.viewerFavorited}
          canManage={view.canManage ?? false}
        />
      )}
      {/* Chip de status (#195) — owner-gated (`canManage`); ausente no caminho público. */}
      {view.canManage && view.visibility && (
        <RecipeStatusChip visibility={view.visibility} m={messages} />
      )}
      {/* Gestão da Imagem (#130) — owner-gated; ausente no caminho público. */}
      {view.canManage && (
        <RecipeImageManager
          recipeId={view.id}
          hasImage={view.imageUrl != null}
          reviewSuggested={reviewImage}
          aiGenEnabled={view.imageGenEnabled ?? true}
        />
      )}
      {/* Afordâncias (#61): dono (gestão) vs não-dono ("Criar minha versão") vs visitante (convite) —
          o client component decide pela sessão; o caminho público mostra o convite/derivar. */}
      <RecipeDetailActions view={view} locale={locale} />
    </Container>
  )
}
