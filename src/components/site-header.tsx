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
 *
 * Seções (ADR-0043): a nav mostra 3 SEÇÕES (Explorar, Minhas receitas, Planejar) em vez de um link por
 * página; as páginas de cada seção viram subabas na `SectionTabs`, logo abaixo do header. O drawer
 * mobile lista as mesmas abas agrupadas sob o título de cada seção. A estrutura vem de
 * `domain/nav-sections`; aqui só se traduz e desenha.
 */
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MenuIcon } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { splitLocalePrefix } from '@/i18n/locale-path'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { AuthSlot } from '@/components/auth-slot'
import { NotificationBell } from '@/components/notification-bell'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  CREATE_DRAWER_TRIGGER_ATTR,
  LazyCreateDrawer,
  preloadCreateDrawer,
  useCreateDrawerStatus,
} from '@/components/recipe/create-drawer-lazy'
import { HomeSearchBar } from '@/components/recipe/home-search-bar'
import { useHomeSearch } from '@/components/recipe/home-search-context'
import { cn } from '@/lib/utils'
import type { TourAnchor } from '@/domain/onboarding-tour'
import {
  activeNav,
  matchesHref,
  sectionEntryHref,
  sectionsFor,
  tabsFor,
  type NavSection,
  type NavSectionId,
} from '@/domain/nav-sections'
import { useLastTabs } from '@/components/nav/last-tab-store'
import { sectionLabel, tabLabel } from '@/components/nav/nav-labels'

// Âncoras do tour guiado (ADR-0039) nos links de seção do desktop. "Explorar" não tem passo próprio.
const SECTION_TOUR: Partial<Record<NavSectionId, TourAnchor>> = {
  minhasReceitas: 'nav-minhas-receitas',
  planejar: 'nav-planejar',
}

// O cluster direito do header é só o slot de conta (AuthSlot). O idioma (#162) e o ThemeToggle
// vivem no footer, então o header não precisa mais nem do seletor de locale nem do tema.
export function SiteHeader() {
  const { messages } = useLocale()
  const session = useSession()
  // Drawer mobile (#163): estado controlado pra fechar ao navegar (clicar num link) sem depender
  // só do clique-fora. O Sheet é o Radix Dialog por baixo; o controle vive aqui no header.
  const [menuOpen, setMenuOpen] = useState(false)
  // Drawer "Nova receita" (#191, ADR-0021): "Criar" no nav ABRE este drawer por cima da tela
  // atual (sem navegar pra /create — o contexto fica atrás). É um Sheet independente do menu
  // mobile acima. Sem deep-links aqui (abre limpo no método-picker); a semeadura por
  // `?q`/`?resume`/`?mode=conversa` é trabalho do shell `/create`.
  // O código da gaveta vem sob demanda (`LazyCreateDrawer`, achado G da auditoria, handoff 70):
  // `createPending` = o clique pediu a abertura e o chunk ainda não chegou (o botão fica `aria-busy`).
  // O pedido pendente se cancela como a gaveta aberta se fecharia antes (ver `LazyCreateDrawer`).
  const [createOpen, setCreateOpen] = useState(false)
  const createDrawerStatus = useCreateDrawerStatus()
  const createPending = createOpen && createDrawerStatus !== 'ready'
  // "Minhas criações" só aparece para quem está logado (Visitante não tem criações). Distinto da
  // Descoberta-home pública (#236): "Minhas criações" é o espaço PRIVADO do dono; a home `/` é o feed
  // público + Busca.
  const authed = !session.isPending && !session.error && !!session.data
  // "Painel" (#125) NÃO vive mais na nav: migrou pro menu da conta (#267), dentro do AuthSlot, que
  // é quem agora computa o gating de papel (curador+, fail-closed). O header só decide "logado?".
  // Link de nav com estado ATIVO (protótipo Header.jsx): a rota atual ganha text-fg +
  // aria-current="page"; inativos herdam o text-muted do <nav> e vão a text-fg no hover.
  // `usePathname()` vem PREFIXADO pelo locale (`/pt-BR/following`), mas os hrefs do nav são NUS
  // (`/`, `/following`) — então tiramos o prefixo (`splitLocalePrefix → rest`) ANTES de comparar.
  // Sem isso o estado ativo NUNCA dispararia (#277: `'/pt-BR/following' === '/following'` é false).
  // `usePathname()` é null fora do contexto de router (ex.: seam jsdom) → null-safe via `rest = '/'`.
  const pathname = usePathname()
  const rest = splitLocalePrefix(pathname ?? '/').rest
  const isActive = (href: string) => matchesHref(rest, href)
  // ADR-0043: a SEÇÃO da rota atual (Explorar fica ativa também em /following e /cooks; Planejar, em
  // qualquer aba dela, inclusive o detalhe de uma lista de compras).
  const activeSectionId = activeNav(rest)?.section.id ?? null
  const lastTabs = useLastTabs()
  // #5: a busca (HomeSearchBar) vive no header SÓ na home (a Descoberta é a home, ADR-0020). Fora da home
  // não há busca no header. `rest === '/'` espelha o `isActive('/')`.
  const isHome = rest === '/'
  // #278 (ADR-0024 emendado): `wide` = a home abriu as 3 colunas das telas largas (publicado pelo
  // SearchExperience via HomeSearchProvider). Quando `true`, o header ALARGA junto (`xl:max-w-wide`) pro
  // MESMO container (96rem) do corpo — a chrome (wordmark/Criar/Você) passa a partilhar a MOLDURA/margens
  // externas do corpo (como no mock). As COLUNAS do corpo centram DENTRO desse container (`justify-center`),
  // então a wordmark fica na borda e a trilha de filtros um tico pra dentro — igual ao protótipo, que
  // também centra as colunas. Anon/busca ⇒ `false` ⇒ header na largura `page` (72rem) APROVADA. Fora da
  // home, irrelevante (sem busca/3-col).
  const { wide } = useHomeSearch()

  // Link de aba do drawer mobile (`wrap` = SheetClose: fecha o painel ao navegar). No desktop as abas
  // vivem na `SectionTabs`, e a nav mostra só as seções (`sectionLink` abaixo).
  const navLink = (
    href: string,
    label: string,
    wrap: (node: React.ReactNode) => React.ReactNode,
  ) =>
    wrap(
      <Link
        href={href}
        aria-current={rest === href ? 'page' : isActive(href) ? 'true' : undefined}
        className={cn('transition-colors hover:text-fg', isActive(href) && 'text-fg')}
      >
        {label}
      </Link>,
    )

  // Link de SEÇÃO do desktop (ADR-0043). Ativo em qualquer aba da seção: `aria-current="page"` só quando
  // a rota é o próprio destino do link; nas outras abas, "true" (item atual do conjunto). O destino das
  // seções pessoais é a última aba visitada (`useLastTabs`), ou a 1ª.
  const sections = sectionsFor(authed)
  const sectionLink = (section: NavSection) => {
    const href = sectionEntryHref(section, lastTabs[section.id])
    const active = activeSectionId === section.id
    return (
      <Link
        key={section.id}
        href={href}
        data-tour={SECTION_TOUR[section.id]}
        aria-current={active ? (rest === href ? 'page' : 'true') : undefined}
        className={cn('transition-colors hover:text-fg', active && 'text-fg')}
      >
        {sectionLabel(messages, section.id)}
      </Link>
    )
  }

  // "Criar" ABRE o drawer (#191) — não navega. No drawer mobile, primeiro FECHA o menu (o
  // SheetClose embrulha o botão) e o seu onClick abre o drawer de criação. No desktop é um botão
  // direto. Mesmo visual de CTA leve (borda em páprica) de antes. Hover, foco e pointerdown
  // pré-carregam o código da gaveta (handoff 70); sem o chunk, o `LazyCreateDrawer` abre assim que
  // ele chega ou, se ele falhou, navega para a `/create`. Um 2º clique com o pedido ainda pendente
  // o CANCELA: antes, esse clique cairia no overlay da gaveta já aberta e a fecharia.
  const ctaButton = (
    <button
      type="button"
      data-tour="criar"
      {...{ [CREATE_DRAWER_TRIGGER_ATTR]: '' }}
      onPointerEnter={preloadCreateDrawer}
      onPointerDown={preloadCreateDrawer}
      onFocus={preloadCreateDrawer}
      onClick={() => {
        if (createPending) {
          setCreateOpen(false)
          return
        }
        preloadCreateDrawer()
        setCreateOpen(true)
      }}
      aria-busy={createPending || undefined}
      className={cn(
        'rounded-md border border-brand/60 px-3 py-1.5 text-brand-ink transition-colors hover:border-brand hover:bg-brand/10',
        createPending && 'cursor-progress',
      )}
    >
      {messages.nav.create}
    </button>
  )
  const ctaLink = (wrap: (node: React.ReactNode) => React.ReactNode) => wrap(ctaButton)

  const inSheet = (node: React.ReactNode) => <SheetClose asChild>{node}</SheetClose>

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur">
      {/* UMA linha que quebra (`flex-wrap`): em xl tudo cabe inline (wordmark · nav · busca · Criar ·
          Você); abaixo de xl a busca (`w-full`) quebra pra 2ª linha. `xl:max-w-wide` SÓ quando a home abre
          as 3 colunas (`wide`) — alinha a chrome com as colunas do corpo; senão fica em `page` (aprovado). */}
      <Container
        className={cn(
          'flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 py-2 sm:gap-y-3',
          isHome && wide && 'xl:max-w-wide',
        )}
      >
        <Link
          href="/"
          className="font-display text-2xl font-semibold tracking-tight text-brand-ink"
        >
          {messages.app.name}
        </Link>
        {/* Nav inline do desktop: escondida abaixo de `sm:` (o drawer assume lá). */}
        <nav className="hidden flex-wrap items-center gap-x-5 gap-y-2 text-sm font-medium text-muted sm:flex">
          {/* ADR-0043: uma entrada por SEÇÃO. "Explorar" (a home, #236/#277) para todos; "Minhas
              receitas" e "Planejar" só logado. "Criar" mora no cluster direito (#5). */}
          {sections.map(sectionLink)}
        </nav>
        {/* Cluster direito do desktop: "Criar" (CTA leve, borda em páprica) + slot de conta —
            espelha o mock `[Criar][Você]`. Escondido abaixo de `sm:` (vai pro drawer). `ml-auto` empurra
            à direita; em xl NA HOME a busca (`flex-1`) ocupa o meio, então o cluster larga o auto-margin
            e fica DEPOIS da busca (`xl:order-3 xl:ml-0`). Fora da home, segue só `ml-auto`. */}
        <div
          className={cn(
            'hidden items-center gap-3 sm:flex',
            isHome ? 'ml-auto xl:order-3 xl:ml-0' : 'ml-auto',
          )}
        >
          {ctaButton}
          {/* Sininho de notificações (#371, só-logado; retorna null p/ anon ⇒ chrome anon intacta). */}
          <NotificationBell />
          {/* Âncora "conta" do tour guiado (ADR-0039): o menu da conta, onde mora o "Como usar". */}
          <div data-tour="conta" className="flex items-center">
            <AuthSlot />
          </div>
        </div>

        {/* Gatilho hambúrguer: só abaixo de `sm:`. O Sheet (Radix Dialog) cuida da a11y. */}
        {/* Abrir o menu também pré-carrega a gaveta: no celular o "Criar" mora aqui dentro. E
            desfaz um pedido de gaveta pendente: antes, com a gaveta aberta (modal), o hambúrguer
            nem era alcançável, então a gaveta nunca empilhava sobre o menu. */}
        <Sheet
          open={menuOpen}
          onOpenChange={(next) => {
            setMenuOpen(next)
            if (next) {
              preloadCreateDrawer()
              if (createPending) setCreateOpen(false)
            }
          }}
        >
          <SheetTrigger
            aria-label={messages.nav.abrirMenu}
            data-tour="menu-mobile"
            className="ml-auto inline-flex size-9 items-center justify-center rounded-md text-fg transition-colors hover:bg-brand/10 sm:hidden"
          >
            <MenuIcon className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" closeLabel={messages.nav.fecharMenu} className="gap-6">
            <SheetHeader>
              <SheetTitle>{messages.nav.menu}</SheetTitle>
              {/* Descrição acessível (sr-only): satisfaz o aria-describedby do Radix Dialog
                  (silencia o warning) e dá contexto a leitores de tela. */}
              <SheetDescription className="sr-only">{messages.nav.menuDescricao}</SheetDescription>
            </SheetHeader>
            {/* ADR-0043: as abas de cada seção, agrupadas sob o título da seção (role=group rotulado,
                como a SectionNav do Console). "Painel" saiu da nav (#267): vive no menu da conta abaixo. */}
            <nav className="flex flex-col items-start gap-5 overflow-y-auto text-base font-medium text-muted">
              {sections.map((s) => {
                const labelId = `menu-secao-${s.id}`
                return (
                  <div key={s.id} role="group" aria-labelledby={labelId} className="flex flex-col items-start gap-3">
                    <span id={labelId} className="text-xs font-semibold tracking-wide text-muted uppercase">
                      {sectionLabel(messages, s.id)}
                    </span>
                    {tabsFor(s, authed).map((t) => (
                      <Fragment key={t.id}>{navLink(t.href, tabLabel(messages, t.id), inSheet)}</Fragment>
                    ))}
                  </div>
                )
              })}
              {ctaLink(inSheet)}
            </nav>
            {/* Área de CONTA dentro do painel: o mesmo AuthSlot do desktop (avatar/nome/Sair, ou
                "Entrar" pro Visitante). Não fecha por SheetClose — "Sair" precisa do seu onClick. */}
            <div className="mt-auto flex items-center gap-3 border-t border-border pt-4">
              {/* Sininho também na área de conta do drawer mobile (null p/ anon). */}
              <NotificationBell />
              <AuthSlot />
            </div>
          </SheetContent>
        </Sheet>

        {/* Busca (HomeSearchBar) — UMA instância, DOM-LAST (preserva a ordem de foco APROVADA abaixo de
            xl: wordmark→nav→Criar→Você→busca). SÓ na home (fora dela não há busca no header). Abaixo de
            xl: `order-last w-full` ⇒ quebra pra 2ª linha; `max-w-reading mx-auto` ⇒ 52rem centrada,
            alinhando com a coluna do corpo (== aprovado). Em xl (≥1280): `xl:order-2 xl:flex-1
            xl:max-w-[35rem]` (e 620px em 2xl) ⇒ INLINE e centrada entre a nav e o cluster (= mock). O
            termo vive no HomeSearchProvider; aqui é só a vista.
            TRADEOFF a11y CONSCIENTE (WCAG 2.4.3): em xl o `order-2` põe a busca VISUALMENTE antes do
            cluster (Criar/Você), mas o tab segue o DOM (DOM-last) ⇒ o teclado alcança Criar/Você ANTES da
            busca. Aceito: a alternativa (DOM entre nav e cluster) só MOVERIA o descasamento pra 2ª linha
            do layout APROVADO abaixo de xl (um único slot no DOM + `order` CSS não satisfaz as duas linhas
            sem duplicar a instância). Otimizamos o caso comum/aprovado (<xl, sem descasamento). */}
        {isHome && (
          <div
            data-tour="busca"
            className="order-last mx-auto w-full max-w-reading pb-1 xl:order-2 xl:w-auto xl:max-w-[35rem] xl:flex-1 xl:pb-0 2xl:max-w-[38.75rem]"
          >
            <HomeSearchBar />
          </div>
        )}
      </Container>

      {/* Drawer "Nova receita" (#191) — controlado pelo header; aberto pelo botão "Criar" do nav
          (desktop e mobile). Renderiza num Portal (Radix Dialog), por cima da chrome. O código vem
          sob demanda (handoff 70): o wrapper monta a mesma `CreateDrawer` quando o chunk chega. */}
      <LazyCreateDrawer open={createOpen} onOpenChange={setCreateOpen} />
    </header>
  )
}
