import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Menu mobile do header (#163) — seam de FRONTEND (issue #54), acima da seam de servidor.
 * jsdom NÃO mede viewport: provamos o COMPORTAMENTO interativo (gatilho hambúrguer abre o
 * drawer; o painel contém nav + conta + Criar; ESC/clique-fora fecham; foco gerenciado) e a
 * presença no DOM — não o breakpoint em pixel (esse fica garantido pelas classes `sm:`).
 *
 * Espelha shell.test.tsx: next/link → <a>, useSession mockável por teste (default Visitante).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const authMock = vi.hoisted(() => {
  const anon = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }
  return { anon, current: anon as unknown }
})
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.current,
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SiteHeader } from '@/components/site-header'

function sessionFor(role: string | null) {
  return {
    data: { user: { id: 'u1', name: 'Ana', email: 'ana@y.z', role, handle: 'ana', deletedAt: null } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: () => {},
  }
}

function renderHeader() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SiteHeader />
    </LocaleProvider>,
  )
}

const ABRIR = ptBR.nav.abrirMenu

afterEach(() => {
  authMock.current = authMock.anon
})

describe('Header mobile — hambúrguer + drawer (#163)', () => {
  it('o gatilho hambúrguer existe com rótulo acessível, e o painel começa fechado', () => {
    renderHeader()
    const trigger = screen.getByRole('button', { name: ABRIR })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Drawer fechado por padrão: nenhum dialog montado.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('o gatilho fica escondido no desktop (sm:hidden) e a nav inline some abaixo de sm (hidden sm:flex)', () => {
    renderHeader()
    const trigger = screen.getByRole('button', { name: ABRIR })
    expect(trigger.className).toContain('sm:hidden')
    // A nav inline do desktop: presente no DOM, escondida abaixo de sm.
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('sm:flex')
    expect(nav.className).toContain('hidden')
  })

  it('clicar no hambúrguer abre o drawer e move o foco pra dentro do painel', async () => {
    const user = userEvent.setup()
    renderHeader()
    const trigger = screen.getByRole('button', { name: ABRIR })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    // Foco gerenciado: entrou no painel (trap do Radix).
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('Visitante: o painel mobile contém a nav (Início), Criar e a CONTA (Entrar)', async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ABRIR }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByRole('link', { name: ptBR.nav.home })).toBeInTheDocument()
    // #236: "Receitas" (índice do feed) fundiu na home — só "Início" (a Descoberta) no nav. A chave
    // i18n `nav.recipes` foi removida; asseguramos a ausência pelo rótulo LITERAL de antes.
    expect(within(dialog).queryByRole('link', { name: 'Receitas' })).toBeNull()
    // #191: "Criar" agora é um BOTÃO (abre o drawer "Nova receita"), não um link de navegação.
    expect(within(dialog).getByRole('button', { name: ptBR.nav.create })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: ptBR.nav.create })).toBeNull()
    // Área de conta: Visitante vê "Entrar".
    expect(within(dialog).getByRole('link', { name: ptBR.nav.signIn })).toBeInTheDocument()
    // Visitante NÃO vê "Minhas criações" nem "Painel".
    expect(within(dialog).queryByText(ptBR.minhasCriacoes.titulo)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(ptBR.nav.painel)).not.toBeInTheDocument()
  })

  it('curador logado: o painel mobile inclui Minhas criações, Criar e o MENU DA CONTA (Painel + Sair)', async () => {
    authMock.current = sessionFor('curador')
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ABRIR }))
    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByRole('link', { name: ptBR.minhasCriacoes.titulo }),
    ).toBeInTheDocument()
    // #191: "Criar" agora é um BOTÃO (abre o drawer "Nova receita"), não um link de navegação.
    expect(within(dialog).getByRole('button', { name: ptBR.nav.create })).toBeInTheDocument()

    // #267: "Painel" e "Sair" saíram da nav/cluster → vivem no MENU DA CONTA (dropdown do avatar),
    // renderizado AQUI dentro do drawer. Há dois AuthSlot no DOM (cluster desktop `hidden sm:flex`
    // + cópia do drawer), então o gatilho da conta (nome 'Ana') é escopado a `within(dialog)`. O
    // conteúdo do menu portaleia pro body → itens buscados por `screen`, NÃO dentro do dialog.
    // Regressão (#267): com o menu FECHADO não há botão "Sair" solto no drawer — ele só existe
    // dentro do dropdown (o antigo botão de topo sumiu).
    expect(within(dialog).queryByRole('button', { name: ptBR.nav.signOut })).toBeNull()
    const accountTrigger = within(dialog).getByRole('button', { name: 'Ana' })
    await user.click(accountTrigger)
    await screen.findByRole('menu')
    expect(accountTrigger).toHaveAttribute('aria-expanded', 'true') // smoke: o menu abriu no jsdom
    expect(screen.getByRole('menuitem', { name: ptBR.nav.painel })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('menuitem', { name: ptBR.nav.signOut })).toBeInTheDocument()
  })

  it('o painel tem descrição acessível (satisfaz o aria-describedby do Radix, #181)', async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ABRIR }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleDescription(ptBR.nav.menuDescricao)
  })

  it('ESC fecha o drawer', async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ABRIR }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('navegar (clicar num link do painel) fecha o drawer', async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ABRIR }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('link', { name: ptBR.nav.home }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('o botão de fechar (X) com rótulo acessível fecha o drawer', async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole('button', { name: ABRIR }))
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: ptBR.nav.fecharMenu }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
