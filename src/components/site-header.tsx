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
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { AuthSlot } from '@/components/auth-slot'
import { isRole } from '@/domain/user'
import { decideRole } from '@/domain/access'

export function SiteHeader() {
  const { messages } = useLocale()
  const session = useSession()
  // "Minhas criações" só aparece para quem está logado (Visitante não tem criações). Distinto do
  // /recipes público (feed da comunidade, #103): este link é o espaço privado do dono.
  const authed = !session.isPending && !session.error && !!session.data
  // "Painel" (#125): atalho para o Console, só a curador+. FAIL-CLOSED igual ao gate de rota
  // (#51): normaliza o papel cru (string → Role|null) e usa `decideRole` do domínio — papel
  // null/desconhecido NUNCA mostra o link. É só afordância; o /admin revalida server-side.
  const rawRole = (session.data?.user as { role?: string | null } | undefined)?.role
  const role = typeof rawRole === 'string' && isRole(rawRole) ? rawRole : null
  const showPainel = authed && decideRole(role, 'curador') === 'allow'
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
          {/* "Minhas criações" (logado) vem ANTES de "Criar". "Criar" é a última e ganha um
              leve destaque de CTA (borda em páprica), sem virar botão cheio. */}
          {authed && (
            <Link href="/me/recipes" className="transition-colors hover:text-fg">
              {messages.minhasCriacoes.titulo}
            </Link>
          )}
          {/* "Painel" (Console) só para curador+, ANTES de "Criar". Esconder é afordância;
              o /admin revalida o papel server-side (gate de rota, não link). */}
          {showPainel && (
            <Link href="/admin" className="transition-colors hover:text-fg">
              {messages.nav.painel}
            </Link>
          )}
          <Link
            href="/create"
            className="rounded-md border border-brand/60 px-3 py-1.5 text-brand-ink transition-colors hover:border-brand hover:bg-brand/10"
          >
            {messages.nav.create}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <AuthSlot />
        </div>
      </Container>
    </header>
  )
}
