'use client'
/**
 * Header do shell (issue #54). Wordmark da marca + navegação (messages.nav) + slot de
 * auth. Client component porque toda a chrome lê `useLocale()` e acompanha a troca de
 * idioma em runtime (#4.AC1) — o seletor de locale vive no footer (SiteFooter). Não
 * chama endpoint de Receita (#4.AC4 — isolamento).
 *
 * Barra com `min-h-16` (não altura fixa) + `flex-wrap`: cresce em vez de cortar quando a
 * wordmark + nav + o botão não cabem numa linha no mobile. Um menu de disclosure entra
 * quando a nav crescer.
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { AuthSlot } from '@/components/auth-slot'

export function SiteHeader() {
  const { messages } = useLocale()
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur-sm">
      <Container className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 py-2">
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight text-brand-ink"
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
          <Link href="/create" className="transition-colors hover:text-fg">
            {messages.nav.create}
          </Link>
          <Link href="/conversation" className="transition-colors hover:text-fg">
            {messages.nav.conversar}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <AuthSlot />
        </div>
      </Container>
    </header>
  )
}
