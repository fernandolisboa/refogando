'use client'
/**
 * Tira de subabas da seção atual (ADR-0043), logo abaixo do header: "Descobrir · Seguindo · Cozinheiros"
 * em Explorar, "Criações · Salvos" em Minhas receitas, "Cardápio · Listas de compras · Despensa" em
 * Planejar. Fora das seções (receita, perfil, /create, /admin, /guia) não renderiza nada.
 *
 * Mora no layout, não em cada página: a tira fica parada ao trocar de aba (as páginas têm larguras
 * diferentes, `reading` e `page`, e a tira de cada página pularia de lugar). Por isso ela segue a
 * largura do HEADER (e alarga junto quando a home abre as 3 colunas), não a do conteúdo.
 *
 * Também grava a última aba das seções pessoais (`rememberTab`), que o link da seção no header usa.
 */
import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { splitLocalePrefix } from '@/i18n/locale-path'
import { useSession } from '@/lib/auth-client'
import { Container } from '@/components/container'
import { useHomeSearch } from '@/components/recipe/home-search-context'
import { activeNav, tabsFor } from '@/domain/nav-sections'
import { rememberTab } from '@/components/nav/last-tab-store'
import { sectionLabel, tabLabel } from '@/components/nav/nav-labels'
import { cn } from '@/lib/utils'

export function SectionTabs() {
  const { messages } = useLocale()
  const session = useSession()
  const rest = splitLocalePrefix(usePathname() ?? '/').rest
  const { wide } = useHomeSearch()
  const active = activeNav(rest)

  const rememberSection = active?.section.remembersLastTab ? active.section.id : null
  const rememberHref = active?.tab.href
  useEffect(() => {
    if (rememberSection && rememberHref) rememberTab(rememberSection, rememberHref)
  }, [rememberSection, rememberHref])

  if (!active) return null

  const authed = !session.isPending && !session.error && !!session.data
  // Seção pessoal: a tira aparece JÁ durante o carregamento da sessão, pra não empurrar a página para
  // baixo quando a sessão resolve (quem abre /me/* quase sempre está logado). Erro ou anônimo: sem tira
  // (a página mostra o próprio estado de Visitante). Na seção pública, a aba só-logada ("Seguindo")
  // espera a sessão: o Visitante nunca a vê piscar.
  const tabs = active.section.authOnly
    ? session.isPending || authed
      ? active.section.tabs
      : []
    : tabsFor(active.section, authed)
  if (tabs.length < 2) return null

  return (
    <div className="border-b border-border">
      <Container className={cn(rest === '/' && wide && 'xl:max-w-wide')}>
        <nav
          aria-label={sectionLabel(messages, active.section.id)}
          className="-mb-px flex gap-x-6 overflow-x-auto whitespace-nowrap text-sm font-medium"
        >
          {tabs.map((t) => {
            const current = t.id === active.tab.id
            return (
              <Link
                key={t.id}
                href={t.href}
                // Na própria aba é a página atual; numa subrota dela (o detalhe de uma lista), a aba
                // continua marcada, mas como "item atual do conjunto", não como a página.
                aria-current={current ? (rest === t.href ? 'page' : 'true') : undefined}
                className={cn(
                  'border-b-2 py-3 transition-colors',
                  current ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg',
                )}
              >
                {tabLabel(messages, t.id)}
              </Link>
            )
          })}
        </nav>
      </Container>
    </div>
  )
}
