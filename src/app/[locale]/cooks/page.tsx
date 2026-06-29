import type { Metadata } from 'next'
import { Container } from '@/components/container'
import { getDb } from '@/server/deps'
import { loadRecommendedCooks } from '@/server/user/recommended-cooks'
import { COOKS_DIRECTORY_PAGE_SIZE, type RecommendedCook } from '@/domain/recommended-cooks-read'
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'
import { CooksDiscovery } from '@/components/recipe/cooks-discovery'

/**
 * Descoberta de Cozinheiros dedicada (#308, `/cooks`) — Server Component que provê o ÚNICO `<main>` e
 * SEMEIA a 1ª página GLOBAL de recomendações (`viewerId` undefined). HTML viewer-independente ⇒
 * anon-cacheável (Modelo B); a personalização do logado é re-buscada no cliente (`CooksDiscovery`).
 *
 * NOINDEX (Modelo B — o social fica FORA do SEO; a porta indexável é a Descoberta de Receitas). Fora do
 * sitemap. O `<h1>` localizado vive no client (useLocale) — um único `<main>`, um único `<h1>`.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function CooksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: rawLocale } = await params
  const locale = canonicalLocale(rawLocale) ?? DEFAULT_LOCALE

  // Seed GLOBAL (sem viewerId). Degrada gracioso (lista vazia) se o DB soluçar — o cliente re-busca no
  // mount; uma superfície de descoberta nunca pode dar tela-de-erro por um hiccup do banco.
  let initialCooks: RecommendedCook[] = []
  let initialNextCursor: string | null = null
  try {
    const page = await loadRecommendedCooks(getDb(), {
      limit: COOKS_DIRECTORY_PAGE_SIZE,
      requestLocale: locale,
    })
    initialCooks = page.cooks
    initialNextCursor = page.nextCursor
  } catch {
    // degrada p/ vazio
  }

  return (
    <Container as="main" className="py-10">
      <CooksDiscovery
        initialCooks={initialCooks}
        initialNextCursor={initialNextCursor}
        locale={locale}
      />
    </Container>
  )
}
