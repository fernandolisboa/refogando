/**
 * Página do perfil PÚBLICO (#129) — Server Component. Mirror de `/recipes/[id]/page.tsx`:
 * resolve o locale do SEGMENTO DA URL (`params.locale`, ADR-0020 — a URL é a verdade do idioma),
 * monta a URL absoluta e faz `fetch` da própria rota `GET /api/u/[handle]` (ADR-0010: a UI consome
 * ROUTE HANDLERS, não Server Actions; não reimplementa domínio), renderizando o `PublicProfile`.
 *
 * ANÔNIMO-readable: NÃO encaminha cookie de sessão (o perfil público é o mesmo p/ todos; nada
 * depende de sessão). 404 leak-safe (handle inexistente/conta desativada) ⇒ `notFound()`. Outro
 * erro ⇒ `throw` (cai em error.tsx global).
 *
 * `fetch` sem cache: leitura viva (o dono pode ter publicado/despublicado/trocado o handle).
 */
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Container } from '@/components/container'
import { PublicProfileView } from '@/components/profile/public-profile-view'
import type { PublicProfile } from '@/domain/recipe-profile-read'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { getBaseUrl } from '@/server/http/base-url'
import { handleResponse } from '@/server/http/handle-response'
import { resolvePageLocale } from '@/server/http/page-locale'

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ locale: string; handle: string }>
}) {
  const { locale: pathLocale, handle } = await params
  const cookieStore = await cookies()
  const headerStore = await headers()

  // Locale-no-caminho (ADR-0020): o idioma exibido vem do SEGMENTO DA URL (`params.locale`),
  // que o proxy garante prefixado e canônico. cookie/Accept-Language ficam só como rede de
  // segurança (defesa em profundidade — nunca tela quebrada se o path chegar inválido).
  const locale = resolvePageLocale({
    urlLocale: pathLocale,
    cookieLocale: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerStore.get('accept-language'),
  })

  const base = await getBaseUrl()
  const url = `${base}/api/u/${encodeURIComponent(handle)}?locale=${encodeURIComponent(locale)}`
  const res = await fetch(url, { cache: 'no-store' })

  const outcome = handleResponse(res)
  if (outcome.kind === 'notFound') notFound()
  if (outcome.kind === 'error') {
    throw new Error(`Falha ao carregar o perfil: ${outcome.status}`)
  }

  const profile = (await res.json()) as PublicProfile
  const messages = MESSAGES[locale]

  return (
    <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
      <PublicProfileView profile={profile} m={messages} locale={locale} />
    </Container>
  )
}
