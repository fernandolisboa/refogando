'use client'
/**
 * Estado global "não encontrado" (issue #54). Client component pra ler messages.system
 * no locale atual e oferecer volta pra home. Renderizado dentro do LocaleProvider do layout.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'

export default function NotFound() {
  const { messages } = useLocale()
  return (
    <main className="mx-auto flex max-w-page flex-col items-start gap-5 px-4 py-24 sm:px-6">
      <p className="font-display text-6xl font-semibold text-brand">404</p>
      <h1 className="text-2xl font-semibold text-fg">{messages.system.notFound}</h1>
      <Link
        href="/"
        className="inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-brand-strong"
      >
        {messages.nav.home}
      </Link>
    </main>
  )
}
