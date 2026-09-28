import type { Metadata } from 'next'
import { UsageGuide } from '@/components/onboarding/usage-guide'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * "Como usar" (ADR-0039): o guia de uso do app, público e indexável, e o ponto de partida para
 * refazer o tour guiado. `generateMetadata` lê só `params` (sem `headers()`/DB) ⇒ build-safe, como
 * a Política de Privacidade.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: urlLocale } = await params
  const locale = resolvePageLocale({ urlLocale })
  return {
    title: MESSAGES[locale].guia.metaTitulo,
  }
}

export default function GuiaPage() {
  return <UsageGuide />
}
