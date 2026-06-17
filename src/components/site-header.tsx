'use client'
/**
 * Header do shell (issue #54). Wordmark da marca + navegação (messages.nav) + seletor
 * de locale + slot de auth (placeholder). Client component porque toda a chrome lê
 * `useLocale()` e troca de idioma em runtime (#4.AC1). Não chama endpoint de Receita
 * (#4.AC4 — isolamento).
 *
 * Nav enxuta (2 itens) cabe inline em mobile; um menu de disclosure entra quando a
 * navegação crescer (fatias futuras).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { LocaleSwitcher } from '@/i18n/locale-switcher'
import { AuthSlot } from '@/components/auth-slot'

export function SiteHeader() {
  const { messages } = useLocale()
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-page flex-wrap items-center gap-x-6 gap-y-2 px-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight text-brand-strong"
        >
          {messages.app.name}
        </Link>
        <nav className="flex items-center gap-5 text-sm font-medium text-muted">
          <Link href="/" className="transition-colors hover:text-fg">
            {messages.nav.home}
          </Link>
          <Link href="/recipes" className="transition-colors hover:text-fg">
            {messages.nav.recipes}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitcher />
          <AuthSlot />
        </div>
      </div>
    </header>
  )
}
