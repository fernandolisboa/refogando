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
import { Container } from '@/components/container'
import { RecipeDetailView } from '@/components/recipe/recipe-detail-view'
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
  searchParams: Promise<{ locale?: string }>
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
    <Container as="main" className="flex flex-col gap-8 py-8 sm:py-12">
      <RecipeDetailView view={view} m={messages} />
    </Container>
  )
}
