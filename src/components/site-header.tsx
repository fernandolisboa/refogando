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
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { AuthSlot } from '@/components/auth-slot'
import { LocaleSwitcher } from '@/i18n/locale-switcher'
import { isRole } from '@/domain/user'
import { decideRole } from '@/domain/access'
import { cn } from '@/lib/utils'

// O cluster direito do header é só idioma + conta (paridade com o protótipo). O ThemeToggle
// vive no footer (recebe `initialTheme` lá), então o header não precisa mais dessa preferência.
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
  // Link de nav com estado ATIVO (protótipo Header.jsx): a rota atual ganha text-fg +
  // aria-current="page"; inativos herdam o text-muted do <nav> e vão a text-fg no hover.
  // `usePathname()` é null fora do contexto de router (ex.: seam jsdom) — null-safe.
  const pathname = usePathname()
  const navLink = (href: string, label: string) => {
    const active =
      pathname != null &&
      (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))
    return (
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn('transition-colors hover:text-fg', active && 'text-fg')}
      >
        {label}
      </Link>
    )
  }
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <Container className="flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 py-2">
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight text-brand-ink"
        >
          {messages.app.name}
        </Link>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-muted">
          {navLink('/', messages.nav.home)}
          {navLink('/recipes', messages.nav.recipes)}
          {/* "Minhas criações" (logado) vem ANTES de "Criar". "Criar" é a última e ganha um
              leve destaque de CTA (borda em páprica), sem virar botão cheio. */}
          {authed && navLink('/me/recipes', messages.minhasCriacoes.titulo)}
          {/* "Painel" (Console) só para curador+, ANTES de "Criar". Esconder é afordância;
              o /admin revalida o papel server-side (gate de rota, não link). */}
          {showPainel && navLink('/admin', messages.nav.painel)}
          <Link
            href="/create"
            className="rounded-md border border-brand/60 px-3 py-1.5 text-brand-ink transition-colors hover:border-brand hover:bg-brand/10"
          >
            {messages.nav.create}
          </Link>
        </nav>
        {/* Cluster direito (paridade com o protótipo): só idioma + conta. O ThemeToggle foi
            pro footer pra o header bater exatamente com o protótipo ([idioma, auth]). */}
        <div className="ml-auto flex items-center gap-3">
          <LocaleSwitcher />
          <AuthSlot />
        </div>
      </Container>
    </header>
  )
}
