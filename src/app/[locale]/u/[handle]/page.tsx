/**
 * Página do perfil PÚBLICO (#129) — Server Component. Mirror de `/recipes/[id]/page.tsx`:
 * resolve o locale do SEGMENTO DA URL (`params.locale`, ADR-0020 — a URL é a verdade do idioma) e
 * chama DIRETO o loader `loadPublicProfile` — o MESMO que o route `GET /api/u/[handle]` usa
 * (ADR-0010: a UI não reimplementa domínio; reusar o loader evita o self-fetch HTTP, que custava uma
 * 2ª invocação de função por visita), renderizando o `PublicProfile`.
 *
 * ANÔNIMO-readable: o loader NUNCA lê sessão (o perfil público é o mesmo p/ todos). 404 leak-safe
 * (handle inexistente/conta desativada ⇒ `null`) ⇒ `notFound()`. Erro do loader propaga (cai em
 * error.tsx global).
 *
 * Leitura viva a cada request (a página já é dinâmica — lê cookies/headers): o dono pode ter
 * publicado/despublicado/trocado o handle.
 *
 * Status HTTP (handoff 72): esta rota fica FORA do grupo `(com-carregamento)`, como `recipes/`, para o
 * `notFound()` sair como 404 de verdade (antes, 200 com a tela de "não encontrado"). Não pôr
 * Suspense/`loading.tsx` acima do `notFound()`. O `<Suspense>` abaixo fica depois da decisão.
 */
import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { Container } from '@/components/container'
import { PublicProfileView } from '@/components/profile/public-profile-view'
import { LOCALE_COOKIE } from '@/i18n/cookie'
import { MESSAGES } from '@/i18n/messages'
import { getDb } from '@/server/deps'
import { resolvePageLocale } from '@/server/http/page-locale'
import { loadPublicProfile } from '@/server/user/public-profile'

// #462: título fino do perfil público = `@handle` (único, zero-custo — vem do param da URL, sem um
// 2º fetch do perfil). Página PÚBLICA/indexável — sem noindex.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; handle: string }>
}): Promise<Metadata> {
  const { handle } = await params
  return { title: `@${handle}` }
}

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

  const profile = await loadPublicProfile(getDb(), handle, locale)
  if (profile === null) notFound()
  const messages = MESSAGES[locale]

  // Suspense sem fallback, só como fronteira de hidratação (o mesmo papel do da página da receita):
  // nada aqui dentro suspende, então o perfil sai inteiro no HTML, com o status já decidido acima.
  // Nada aqui dentro pode chamar `useSearchParams()`: sem o aviso do build, o corpo do perfil (público e
  // indexável) sumiria do HTML em silêncio (ver o comentário do `DetailChrome` da receita).
  return (
    <Suspense>
      <Container as="main" size="reading" className="flex flex-col gap-8 py-8 sm:py-12">
        <PublicProfileView profile={profile} m={messages} locale={locale} />
      </Container>
    </Suspense>
  )
}
