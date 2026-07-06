import type { Metadata } from 'next'
import { PlanoPlaceholder } from '@/components/plano/plano-placeholder'
import { resolvePageLocale } from '@/server/http/page-locale'
import { MESSAGES } from '@/i18n/messages'

/**
 * Página placeholder `/plano` (Fase 2 de billing, flag-off — ver
 * `docs/reports/fase2-billing-decisao.md` §6 item 5). Destino do CTA ESTÁTICO do cartão de upsell
 * no limite de cota (`QuotaUpsellCard`): "em breve", sem afirmar preço/data, sem checkout/PSP.
 * Indexável de propósito (sem `robots: noindex`) — espelha `privacidade`/`seus-direitos`.
 *
 * `generateMetadata` lê só `params` (sem `headers()`/DB) ⇒ build-safe.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale: urlLocale } = await params
  const locale = resolvePageLocale({ urlLocale })
  return {
    title: MESSAGES[locale].plano.metaTitulo,
  }
}

export default function PlanoPage() {
  return <PlanoPlaceholder />
}
