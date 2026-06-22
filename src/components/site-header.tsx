'use client'
/**
 * Header do shell (issue #54). Wordmark da marca + navegação (messages.nav) + slot de
 * auth. Client component porque toda a chrome lê `useLocale()` e acompanha a troca de
 * idioma em runtime (#4.AC1) — o seletor de locale vive no footer (SiteFooter, #162). Não
 * chama endpoint de Receita (#4.AC4 — isolamento).
 *
 * Responsivo (#163): no desktop (`sm:+`) a nav completa + o AuthSlot ficam INLINE; abaixo de
 * `sm:` eles somem (`hidden sm:flex`) e entra um gatilho hambúrguer (`sm:hidden`) que abre um
 * drawer (primitiva `ui/sheet`, sobre Radix Dialog) com a nav + a conta + Criar. O drawer
 * herda do Dialog a a11y crítica: foco move pro painel, ESC fecha, clique-fora fecha, trap de
 * foco, e o gatilho ganha `aria-expanded`/`aria-controls`. Fecha ao navegar via `SheetClose`.
 */
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MenuIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { AuthSlot } from '@/components/auth-slot'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { isRole } from '@/domain/user'
import { decideRole } from '@/domain/access'
import { cn } from '@/lib/utils'

// O cluster direito do header é só o slot de conta (AuthSlot). O idioma (#162) e o ThemeToggle
// vivem no footer, então o header não precisa mais nem do seletor de locale nem do tema.
export function SiteHeader() {
  const { messages } = useLocale()
  const session = useSession()
  // Drawer mobile (#163): estado controlado pra fechar ao navegar (clicar num link) sem depender
  // só do clique-fora. O Sheet é o Radix Dialog por baixo; o controle vive aqui no header.
  const [menuOpen, setMenuOpen] = useState(false)
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
  const isActive = (href: string) =>
    pathname != null &&
    (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`))

  // Item de nav reutilizado nas DUAS vistas. No drawer mobile (`wrap` = SheetClose) cada link
  // fecha o painel ao navegar; no desktop o wrap é a identidade (link inline puro).
  const navLink = (href: string, label: string, wrap: (node: React.ReactNode) => React.ReactNode) =>
    wrap(
      <Link
        href={href}
        aria-current={isActive(href) ? 'page' : undefined}
        className={cn('transition-colors hover:text-fg', isActive(href) && 'text-fg')}
      >
        {label}
      </Link>,
    )

  const ctaLink = (wrap: (node: React.ReactNode) => React.ReactNode) =>
    wrap(
      <Link
        href="/create"
        className="rounded-md border border-brand/60 px-3 py-1.5 text-brand-ink transition-colors hover:border-brand hover:bg-brand/10"
      >
        {messages.nav.create}
      </Link>,
    )

  const identity = (node: React.ReactNode) => node
  const inSheet = (node: React.ReactNode) => <SheetClose asChild>{node}</SheetClose>

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      <Container className="flex min-h-16 items-center gap-x-6 py-2">
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight text-brand-ink"
        >
          {messages.app.name}
        </Link>
        {/* Nav inline do desktop: escondida abaixo de `sm:` (o drawer assume lá). */}
        <nav className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-muted sm:flex">
          {navLink('/', messages.nav.home, identity)}
          {navLink('/recipes', messages.nav.recipes, identity)}
          {/* "Minhas criações" (logado) vem ANTES de "Criar". "Criar" é a última e ganha um
              leve destaque de CTA (borda em páprica), sem virar botão cheio. */}
          {authed && navLink('/me/recipes', messages.minhasCriacoes.titulo, identity)}
          {/* "Painel" (Console) só para curador+, ANTES de "Criar". Esconder é afordância;
              o /admin revalida o papel server-side (gate de rota, não link). */}
          {showPainel && navLink('/admin', messages.nav.painel, identity)}
          {ctaLink(identity)}
        </nav>
        {/* Cluster direito do desktop: só o slot de conta. Escondido abaixo de `sm:` (vai pro
            drawer). O idioma (#162) e o ThemeToggle foram pro footer. */}
        <div className="ml-auto hidden items-center gap-3 sm:flex">
          <AuthSlot />
        </div>

        {/* Gatilho hambúrguer: só abaixo de `sm:`. O Sheet (Radix Dialog) cuida da a11y. */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger
            aria-label={messages.nav.abrirMenu}
            className="ml-auto inline-flex size-9 items-center justify-center rounded-md text-fg transition-colors hover:bg-brand/10 sm:hidden"
          >
            <MenuIcon className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" closeLabel={messages.nav.fecharMenu} className="gap-6">
            <SheetHeader>
              <SheetTitle>{messages.nav.menu}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col items-start gap-4 text-base font-medium text-muted">
              {navLink('/', messages.nav.home, inSheet)}
              {navLink('/recipes', messages.nav.recipes, inSheet)}
              {authed && navLink('/me/recipes', messages.minhasCriacoes.titulo, inSheet)}
              {showPainel && navLink('/admin', messages.nav.painel, inSheet)}
              {ctaLink(inSheet)}
            </nav>
            {/* Área de CONTA dentro do painel: o mesmo AuthSlot do desktop (avatar/nome/Sair, ou
                "Entrar" pro Visitante). Não fecha por SheetClose — "Sair" precisa do seu onClick. */}
            <div className="mt-auto border-t border-border pt-4">
              <AuthSlot />
            </div>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  )
}
