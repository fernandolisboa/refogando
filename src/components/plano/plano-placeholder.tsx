'use client'
/**
 * Corpo da página placeholder `/plano` (Fase 2 de billing, flag-off — ver
 * `docs/reports/fase2-billing-decisao.md` §6 item 5). Destino ESTÁTICO do CTA de upsell no limite
 * de cota (`QuotaUpsellCard`) — "em breve", SEM afirmar preço nem data (decisão comercial pendente,
 * issue #467) e SEM checkout/PSP. Publicada (indexável, sem `robots: noindex`), no mesmo padrão de
 * `PrivacyPolicy`/`SeusDireitos`: client component pra acompanhar o locale em runtime, todo o texto
 * vem de `messages.plano` — nada hardcoded aqui.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'

export function PlanoPlaceholder() {
  const { locale, messages } = useLocale()
  const m = messages.plano

  return (
    <Container as="main" size="reading" className="py-10">
      <h1 className="font-display text-3xl font-semibold text-brand-ink">{m.titulo}</h1>
      <p className="mt-4 max-w-[60ch] leading-relaxed text-fg">{m.corpo}</p>
      <div className="mt-6">
        <Button asChild variant="secondary">
          <Link href={`/${locale}`}>{m.voltar}</Link>
        </Button>
      </div>
    </Container>
  )
}
