'use client'
/**
 * Estado global "não encontrado" (issue #54). Client component pra ler messages.system
 * no locale atual e oferecer volta pra home. Renderizado dentro do LocaleProvider do layout.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  const { messages } = useLocale()
  return (
    <Container as="main" className="flex flex-col items-start gap-5 py-24">
      <p className="font-display text-6xl font-semibold text-brand-ink">404</p>
      <h1 className="text-2xl font-semibold text-fg">{messages.system.notFound}</h1>
      <Button asChild variant="secondary">
        <Link href="/">{messages.nav.home}</Link>
      </Button>
    </Container>
  )
}
