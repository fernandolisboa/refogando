/**
 * Página de detalhe da Receita (#57) — Server Component. Orquestra a leitura localizada:
 * resolve o locale (precedência de `?locale` da URL → cookie → Accept-Language), monta a
 * URL absoluta, faz `fetch` da própria rota `GET /api/recipes/[id]` (ADR-0010: a UI
 * consome ROUTE HANDLERS, não Server Actions; não reimplementa domínio) ENCAMINHANDO o
 * cookie de sessão (senão a rota vê requisição anônima e o dono nunca lê a própria
 * receita privada) e renderiza o shape `RecipeView` que a rota devolve.
 *
 * 404 leak-safe (rota): malformado/ausente/sem-acesso devolvem o MESMO 404 → `notFound()`.
 * Outro erro → `throw` (cai em `error.tsx` global). O fallback de loading é o `loading.tsx`
 * global (Suspense). A lógica testável (status→efeito, precedência de locale) vive em
 * helpers PUROS (`handleResponse`, `resolvePageLocale`) — `headers()` lança fora do request
 * scope no jsdom, então a page não é testável lá, mas seus branches são.
 *
 * `fetch` sem cache: leitura viva; evita servir receita privada cacheada.
 */
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Container } from '@/components/container'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
import { RecipeImageManager } from '@/components/recipe/recipe-image-manager'
import { RecipeDetailActions } from '@/components/recipe/recipe-detail-actions'
import { RecipeEngagementControls } from '@/components/recipe/recipe-engagement-controls'
import { RecipeVisibilityControls } from '@/components/recipe/recipe-visibility-controls'
import type { RecipeView } from '@/domain/recipe-read'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { getBaseUrl } from '@/server/http/base-url'
import { handleResponse } from '@/server/http/handle-response'
import { resolvePageLocale } from '@/server/http/page-locale'

export default async function RecipeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ locale?: string; reviewImage?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const cookieStore = await cookies()
  const headerStore = await headers()

  const locale = resolvePageLocale({
    urlLocale: sp.locale ?? null,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })

  const base = await getBaseUrl()
  const url = `${base}/api/recipes/${encodeURIComponent(id)}?locale=${encodeURIComponent(locale)}`
  // Encaminha o cookie de sessão da requisição de entrada: o self-fetch server-to-server
  // NÃO leva os cookies do browser, então sem isto a rota vê uma requisição anônima e
  // devolve 404 para receita privada — INCLUSIVE para o próprio dono. `cache: 'no-store'`
  // permanece (resposta dependente de sessão nunca pode ser cacheada).
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
  const messages = MESSAGES[locale]

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      {/* Voltar à busca (protótipo): primeiro elemento, muted; href estável "/" (a home É a
          busca) — mais robusto que history.back() em carga direta/deep-link. */}
      <Link href="/" className="text-sm text-muted transition-colors hover:text-fg">
        ← {messages.detalhe.voltarBusca}
      </Link>
      <RecipeDetailView view={view} m={messages} />
      {/* Controles de Engajamento da Comunidade (#62) — voto + favorito. Gate pela presença
          do AGREGADO DE POOL (`voteCount`), NÃO pelo estado do viewer: a rota só emite
          `voteCount` quando a Receita está no POOL (isPublicRead). Em owned-private a rota
          AINDA define `viewerVoted`/`viewerFavorited` (gateados por viewerId, não por pool),
          então gatear por esses campos faria os controles aparecerem numa Receita fora do
          pool — e o botão Favoritar sempre falharia 404 (`applyFavorite` aplica o gate de
          pool). `voteCount != null` é o ÚNICO sinal de "está no pool". `canManage` coexiste
          (dono no pool vê a própria contagem). Page fina: o campo já chega na view (ADR-0010). */}
      {view.voteCount != null && (
        <RecipeEngagementControls
          recipeId={view.id}
          initialVoteCount={view.voteCount}
          initialViewerVoted={view.viewerVoted}
          initialViewerFavorited={view.viewerFavorited}
          canManage={view.canManage ?? false}
        />
      )}
      {/* Controles de Visibilidade SÓ pro dono (#59) — a rota gateia canManage/visibility/
          resultKind ao dono; o servidor reimpõe ownership/playful. Sem chamada extra a DB:
          o ownership chega na própria view (page segue orquestrador fino, ADR-0010). */}
      {view.canManage && view.visibility && view.resultKind && (
        <RecipeVisibilityControls
          recipeId={view.id}
          initialVisibility={view.visibility}
          resultKind={view.resultKind}
        />
      )}
      {/* Gestão da Imagem da receita (#130) SÓ pro dono (canManage) — subir/trocar/remover a foto.
          O servidor reimpõe ownership/ref-count; a page só passa se há imagem (gateia o botão
          Remover/o label Trocar). O hero da foto vive no RecipeDetailView (acima). */}
      {view.canManage && (
        <RecipeImageManager
          recipeId={view.id}
          hasImage={view.imageUrl != null}
          // #131: `?reviewImage=1` (anexado pelos fluxos de editar/derivar/regenerar quando a
          // mudança foi VISUAL) destaca a sugestão de revisar a foto carregada-pra-frente.
          reviewSuggested={sp.reviewImage === '1'}
          // #134: geração-por-IA-ligada (owner-gated na view). Ausente ⇒ default true no manager.
          aiGenEnabled={view.imageGenEnabled ?? true}
        />
      )}
      {/* Afordâncias do detalhe (#61): para o DONO, gestão (editar/apagar/regenerar/diff da
          derivada); para o NÃO-dono, "Criar minha versão" (derivar) ou o convite de entrar
          (Visitante, descope #22). O componente lê SÓ a view (server-truth) + a sessão (gating
          de derivar). Salvar/publicar continua nos controles de Visibilidade (#59) acima. */}
      <RecipeDetailActions view={view} locale={locale} />
    </Container>
  )
}
