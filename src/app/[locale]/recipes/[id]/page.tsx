/**
 * Página de detalhe da Receita (#57, #230) — Server Component. URL canônica = SLUG per-locale
 * (`/{locale}/recipes/<slug>`, ADR-0020 decisão 4); o UUID legado é PERMANENT-redirecionado pro
 * slug. O segmento dinâmico `[id]` carrega OU um slug OU (links antigos) o UUID interno.
 *
 * DOIS caminhos de leitura, deliberadamente separados (ADR-0020 — "leitura indexável anônima e
 * cacheável, separada da leitura do dono"):
 *
 *  1. PÚBLICO/INDEXÁVEL (slug): `loadPublicRecipeBySlug` lê do DB DIRETO, ANÔNIMO e CACHEÁVEL —
 *     SEM cookie/sessão, SEM self-fetch com `no-store`, SEM forçar render dinâmico, SEM
 *     personalizar pro crawler. Aplica o gate de leitura pública (= gate de indexação default-open:
 *     pública E não-`playful` E não-removida). Achou ⇒ renderiza a view só-leitura e termina SEM
 *     tocar cookies (a rota fica estaticamente renderizável/cacheável). É o caminho quente do
 *     Google e de qualquer anônimo. `RecipeDetailActions` é client component (`useSession`) ⇒ a
 *     afordância "Criar minha versão"/convite resolve no cliente sem cookie no servidor.
 *
 *  2. DONO (privado/dinâmico): só quando o caminho 1 devolve `null` (Receita privada/playful/
 *     removida OU slug inexistente) caímos no caminho do dono — `?original` legado + self-fetch
 *     `/api/recipes/[id]` com cookie de sessão (a rota reimpõe ownership e devolve 404 leak-safe a
 *     quem não é dono). Esse caminho é dinâmico por natureza (lê cookie) e PRESERVA o fluxo de
 *     leitura+edição do dono do rework Criar/Editar — mas NÃO contamina o caminho 1.
 *
 * UUID legado ⇒ `resolveSlugForLocale` acha o slug do locale e dá **permanentRedirect** (308 no
 * Next — o redirect PERMANENTE idiomático de Server Component; consolida link equity como o 301 do
 * ADR, já que o framework não emite 301 literal aqui). Sem slug naquele locale ⇒ 404 leak-safe.
 */
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/container'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
import { RecipeImageManager } from '@/components/recipe/recipe-image-manager'
import { RecipeDetailActions } from '@/components/recipe/recipe-detail-actions'
import { RecipeEngagementControls } from '@/components/recipe/recipe-engagement-controls'
import { RecipeStatusChip } from '@/components/recipe/recipe-status-chip'
import { recipeTranslation } from '@/db/schema'
import type { RecipeView } from '@/domain/recipe-read'
import { resolveRecipeView } from '@/domain/recipe-read'
import { decideRecipeDetailRoute, recipeDetailPath } from '@/domain/recipe-detail-route'
import type { Locale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'
import { getDb } from '@/server/deps'
import { loadPublicRecipeBySlug, loadSocialState, resolveSlugForLocale } from '@/server/recipe/load'
import { getBaseUrl } from '@/server/http/base-url'
import { handleResponse } from '@/server/http/handle-response'
import { resolvePageLocale, resolveContentLocale } from '@/server/http/page-locale'

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

  // Decisão PURA de forma do param: UUID legado (resolver slug + 308) vs slug (renderizar público).
  const route = decideRecipeDetailRoute(id)

  // ── UUID legado: resolve o slug do locale e PERMANENT-redirect pro canônico ─────────────────
  if (route.kind === 'redirect-uuid') {
    const slug = await resolveSlugForLocale(getDb(), route.uuid, locale)
    // Sem slug naquele locale (Receita inexistente / sem tradução / slug ainda NULL): 404 leak-safe
    // (não revela existência; espelha a postura do GET por uuid). permanentRedirect NÃO retorna.
    if (slug == null) notFound()
    permanentRedirect(recipeDetailPath(locale, slug))
  }

  // ── PÚBLICO por slug: leitura ANÔNIMA e CACHEÁVEL via DB direto (NÃO toca cookie/sessão) ─────
  const publicRows = await loadPublicRecipeBySlug(getDb(), route.slug, locale)
  if (publicRows != null) {
    // Contagem de votos: agregado PÚBLICO de pool — anônimo, sem cookie (não personaliza nem força
    // dinâmico). `viewerVoted`/`viewerFavorited` ficam AUSENTES (anônimo) — o estado do viewer é
    // resolvido no cliente pelos controles quando logado. Mantém a rota cacheável.
    const social = await loadSocialState(getDb(), { id: publicRows.recipe.id, includeVoteCount: true })
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
    return <DetailChrome view={view} locale={locale} reviewImage={false} />
  }

  // ── DONO/privado: caminho DINÂMICO (cookie). Só chega aqui quando a leitura pública deu null
  //    (privada/playful/removida OU slug inexistente). Reusa a rota /api/recipes/[id] que reimpõe
  //    ownership e devolve 404 leak-safe a quem não é dono — preserva o fluxo leitura+edição do dono.
  const sp = await searchParams
  // `headers()` (lido para encaminhar o cookie de sessão abaixo) já marca ESTE branch como
  // DINÂMICO (correto — leitura do dono), sem afetar o branch público acima (que retornou sem
  // tocar `headers()`/`cookies()`, ficando estaticamente renderizável/cacheável).
  const headerStore = await headers()

  // No caminho do dono o `[id]` é um SLUG (o link interno do dono já usa o slug). Resolve o UUID
  // interno (chave da API de dados) achando a Receita pelo slug — INCLUSIVE privada do dono, então
  // a busca aqui NÃO aplica o gate público. Sem casamento ⇒ 404 leak-safe.
  const ownerUuid = await resolveRecipeIdBySlug(route.slug, locale)
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
 * Resolve o UUID interno de uma Receita por (locale, slug) SEM aplicar o gate público — usado SÓ
 * no caminho do dono (caminho 2), onde a Receita pode ser privada. Privado à page.
 */
async function resolveRecipeIdBySlug(slug: string, locale: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ recipeId: recipeTranslation.recipeId })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.locale, locale), eq(recipeTranslation.slug, slug)))
    .limit(1)
  return row?.recipeId ?? null
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
}: {
  view: RecipeView
  locale: Locale
  reviewImage: boolean
}) {
  const messages = MESSAGES[locale]
  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
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
