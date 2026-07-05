import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link → <a> simples (não há AppRouterContext no jsdom).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #372: AuthSlot passou a ler `usePathname` (refetch ao navegar). Controlado por variável de
// módulo; a mudança de pathname é exercitada via rerender.
let mockPathname = '/pt-BR'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

// Factory de mock de sessão — shape COMPLETO de useSession (data/error/isPending/
// isRefetching/refetch), reusado por todos os cenários. `refetch` é espião por instância.
// `role`/`handle` são lidos por cast de runtime no AuthSlot (#267): o tipo do mock os inclui pra
// alimentar o gating de "Painel" e o item "Ver meu perfil público".
type SessionUser = { id: string; name?: string; email: string; role?: string; handle?: string | null }
type SessionData = { user: SessionUser } | null
const fakeSession = (over: Partial<{ data: SessionData; error: unknown; isPending: boolean }> = {}) => ({
  data: null as SessionData,
  error: null as unknown,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
  ...over,
})

// Estado controlável por variável de módulo: cada teste seta o retorno antes de renderizar.
let mockSession = fakeSession()
const signOut = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockSession,
  signOut: (...args: unknown[]) => signOut(...args),
}))

import { LocaleProvider } from '@/i18n/provider'
import { AuthSlot } from '@/components/auth-slot'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'

function renderSlot(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AuthSlot />
    </LocaleProvider>,
  )
}

// Default autenticado: nome 'Ana', SEM imagem (Avatar cai nas iniciais aria-hidden → o nome
// acessível do gatilho é só "Ana"), handle 'ana' (alimenta /u/ana). `role` undefined por padrão
// (papel-base → sem "Painel"). `over` ajusta qualquer campo (ex.: handle: undefined, role: 'curador').
const authed = (over: Partial<SessionUser> = {}) =>
  fakeSession({ data: { user: { id: 'u1', name: 'Ana', email: 'ana@ex.com', handle: 'ana', ...over } } })

// Abre o menu da conta: clica no gatilho (nome do usuário) e espera o `role=menu` montar (portaleia
// pro body — os itens NÃO ficam dentro do container do render, então as buscas usam `screen`).
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  const trigger = screen.getByRole('button', { name })
  await user.click(trigger)
  await screen.findByRole('menu')
  return trigger
}

describe('AuthSlot — estado de sessão na chrome (#55) + menu da conta (#267)', () => {
  beforeEach(() => {
    mockSession = fakeSession()
    signOut.mockClear()
    mockPathname = '/pt-BR'
  })
  afterEach(() => {
    // Restaura qualquer override de visibilityState pra não vazar entre testes no jsdom compartilhado.
    vi.restoreAllMocks()
  })

  it('anônimo: mostra Entrar com href /sign-in?returnTo=<pathname>, sem gatilho de conta nem Sair', () => {
    mockSession = fakeSession()
    mockPathname = '/pt-BR/u/ana'
    renderSlot('pt-BR')
    const link = screen.getByRole('link', { name: ptBR.nav.signIn })
    // #458: propaga returnTo (o mecanismo anti open-redirect do sign-in sanitiza no server).
    expect(link).toHaveAttribute('href', '/sign-in?returnTo=%2Fpt-BR%2Fu%2Fana')
    // Anônimo não tem menu de conta: NENHUM botão (o "Entrar" é um link, não um gatilho de popup).
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(ptBR.nav.signOut)).not.toBeInTheDocument()
  })

  it('autenticado: avatar+nome é um BOTÃO de menu (aria-haspopup), não um link', () => {
    mockSession = authed()
    renderSlot('pt-BR')
    const trigger = screen.getByRole('button', { name: 'Ana' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    // Não navega mais direto: o nome NÃO é um link.
    expect(screen.queryByRole('link', { name: 'Ana' })).not.toBeInTheDocument()
  })

  it('abrir o menu revela Editar perfil (→/me/profile), Ver meu perfil público (→/u/ana) e Sair', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    renderSlot('pt-BR')
    await openMenu(user, 'Ana')

    const editar = screen.getByRole('menuitem', { name: ptBR.nav.editarPerfil })
    expect(editar).toHaveAttribute('href', '/me/profile')
    const publico = screen.getByRole('menuitem', { name: ptBR.nav.verPerfilPublico })
    expect(publico).toHaveAttribute('href', '/u/ana')
    expect(screen.getByRole('menuitem', { name: ptBR.nav.signOut })).toBeInTheDocument()
    // Sem papel curador+: "Painel" não aparece.
    expect(screen.queryByRole('menuitem', { name: ptBR.nav.painel })).not.toBeInTheDocument()
  })

  it('handle ausente: o item "Ver meu perfil público" não aparece (degradação graciosa)', async () => {
    const user = userEvent.setup()
    mockSession = authed({ handle: undefined })
    renderSlot('pt-BR')
    await openMenu(user, 'Ana')

    expect(screen.queryByRole('menuitem', { name: ptBR.nav.verPerfilPublico })).not.toBeInTheDocument()
    // Editar perfil segue presente (não depende de handle).
    expect(screen.getByRole('menuitem', { name: ptBR.nav.editarPerfil })).toHaveAttribute(
      'href',
      '/me/profile',
    )
  })

  it('curador VÊ "Painel" (→/admin) no menu; usuário e papel desconhecido NÃO', async () => {
    const user = userEvent.setup()

    mockSession = authed({ role: 'curador' })
    const { unmount } = renderSlot('pt-BR')
    await openMenu(user, 'Ana')
    expect(screen.getByRole('menuitem', { name: ptBR.nav.painel })).toHaveAttribute('href', '/admin')
    unmount()
    // Settle: garante o menu portaleado do render anterior some antes do próximo abrir (evita
    // achar um menu obsoleto sob carga fria — flake conhecido da suíte ui).
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    mockSession = authed({ role: 'usuario' })
    const r2 = renderSlot('pt-BR')
    await openMenu(user, 'Ana')
    expect(screen.queryByRole('menuitem', { name: ptBR.nav.painel })).not.toBeInTheDocument()
    r2.unmount()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    // Papel desconhecido = fail-closed (igual ao gate de rota #51).
    mockSession = authed({ role: 'superusuario' })
    renderSlot('pt-BR')
    await openMenu(user, 'Ana')
    expect(screen.queryByRole('menuitem', { name: ptBR.nav.painel })).not.toBeInTheDocument()
  })

  it('autenticado sem nome: o gatilho cai pro email', () => {
    mockSession = authed({ name: undefined })
    renderSlot('pt-BR')
    expect(screen.getByRole('button', { name: 'ana@ex.com' })).toBeInTheDocument()
  })

  it('clicar Sair chama signOut e refetch, depois reflete anônimo', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    const { rerender } = renderSlot('pt-BR')

    await openMenu(user, 'Ana')
    await user.click(screen.getByRole('menuitem', { name: ptBR.nav.signOut }))
    // onSelect é async (void doSignOut()): signOut/refetch resolvem em microtask posterior ao
    // close-on-select do Radix → afirmar via waitFor (não sincronamente, p/ não correr a corrida).
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockSession.refetch).toHaveBeenCalledTimes(1))

    // Sessão resolveu pra anônima; a chrome reflete "Entrar" de volta.
    mockSession = fakeSession()
    rerender(
      <LocaleProvider initialLocale="pt-BR">
        <AuthSlot />
      </LocaleProvider>,
    )
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toBeInTheDocument()
    expect(screen.queryByText(ptBR.nav.signOut)).not.toBeInTheDocument()
  })

  it('Esc fecha o menu e o foco volta pro gatilho', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    renderSlot('pt-BR')
    const trigger = await openMenu(user, 'Ana')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('teclado: o gatilho abre o menu por Enter e por ArrowDown (a11y do AC)', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    renderSlot('pt-BR')
    const trigger = screen.getByRole('button', { name: 'Ana' })

    trigger.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // Fecha (foco volta pro gatilho) e reabre por seta — Radix dá navegação por teclado de graça.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    await user.keyboard('{ArrowDown}')
    await screen.findByRole('menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('clique fora fecha o menu (modal=false, sem overlay capturando o clique)', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <button data-testid="fora">fora</button>
        <AuthSlot />
      </LocaleProvider>,
    )
    await openMenu(user, 'Ana')
    await user.click(screen.getByTestId('fora'))
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  // #372 (ADR-0028 dec 5-B): refetch no foco / ao ficar visível / ao navegar — a chrome corrige
  // papel velho em segundos, sem reload, sem toast.
  it('refetcha no foco da aba e ao ficar visível', () => {
    mockSession = authed()
    renderSlot('pt-BR')
    // O useSession já fez o fetch de mount (não instrumentado aqui); zeramos pra medir só os eventos.
    mockSession.refetch.mockClear()

    window.dispatchEvent(new Event('focus'))
    expect(mockSession.refetch).toHaveBeenCalledTimes(1)

    // Voltar a ficar visível também refetcha (dupla-chamada com focus é intencional/idempotente).
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mockSession.refetch.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('visibilitychange com hide NÃO refetcha (guard do landmine)', () => {
    mockSession = authed()
    renderSlot('pt-BR')
    mockSession.refetch.mockClear()

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(mockSession.refetch).not.toHaveBeenCalled()
  })

  it('refetcha ao navegar (pathname muda), pulando a 1ª renderização', () => {
    mockSession = authed()
    const { rerender } = renderSlot('pt-BR')
    // Sem navegação ainda: o efeito B pula o 1º run (não duplica o fetch de mount do useSession).
    mockSession.refetch.mockClear()

    mockPathname = '/pt-BR/receitas'
    rerender(
      <LocaleProvider initialLocale="pt-BR">
        <AuthSlot />
      </LocaleProvider>,
    )
    expect(mockSession.refetch).toHaveBeenCalled()
  })

  it('promoção de papel reflete sem re-login (após refetch server-side)', async () => {
    const user = userEvent.setup()
    mockSession = authed({ role: 'usuario' })
    const { rerender, unmount } = renderSlot('pt-BR')
    await openMenu(user, 'Ana')
    expect(screen.queryByRole('menuitem', { name: ptBR.nav.painel })).not.toBeInTheDocument()
    // Fecha o menu portaleado antes de reabrir (flake conhecido da suíte ui).
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    // Modela o estado do servidor pós-refetch (admin promoveu esta pessoa a curador).
    mockSession = authed({ role: 'curador' })
    rerender(
      <LocaleProvider initialLocale="pt-BR">
        <AuthSlot />
      </LocaleProvider>,
    )
    await openMenu(user, 'Ana')
    expect(screen.getByRole('menuitem', { name: ptBR.nav.painel })).toHaveAttribute('href', '/admin')
    unmount()
  })

  it('isPending não instala listeners de foco (efeito A com early-return)', () => {
    mockSession = fakeSession({ isPending: true })
    renderSlot('pt-BR')
    mockSession.refetch.mockClear()
    window.dispatchEvent(new Event('focus'))
    expect(mockSession.refetch).not.toHaveBeenCalled()
  })

  it('isPending: espaçador com dimensão (aria-hidden), sem piscar Entrar/Sair', () => {
    mockSession = fakeSession({ isPending: true })
    const { container } = renderSlot('pt-BR')
    // Espaçador puramente visual: fora da árvore de a11y (aria-hidden), só reserva espaço.
    const spacer = container.querySelector('[aria-hidden="true"]')
    expect(spacer).toBeInTheDocument()
    expect(spacer?.className).toMatch(/min-w-/)
    expect(spacer?.className).toMatch(/h-8/)
    expect(screen.queryByText(ptBR.nav.signIn)).not.toBeInTheDocument()
    expect(screen.queryByText(ptBR.nav.signOut)).not.toBeInTheDocument()
  })

  it('error de sessão COM sessão presente: fail-open pra anônimo (não trava a chrome)', () => {
    // Isola o ramo `error ||`: sessão presente (stale) MAIS erro de get-session. Se o guard
    // regredisse pra `if (!session)`, renderizaria o gatilho de conta — então este caso trava a
    // invariante de fail-open que `data:null` sozinho não exercita.
    mockSession = fakeSession({ ...authed(), error: new Error('get-session falhou') })
    renderSlot('pt-BR')
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ana' })).not.toBeInTheDocument()
    expect(screen.queryByText(ptBR.nav.signOut)).not.toBeInTheDocument()
  })

  it('en-US: rótulos em inglês (anônimo e itens do menu autenticado)', async () => {
    const user = userEvent.setup()
    mockSession = fakeSession()
    const { unmount } = renderSlot('en-US')
    expect(screen.getByText(enUS.nav.signIn)).toBeInTheDocument()
    unmount()

    mockSession = authed({ role: 'curador' })
    renderSlot('en-US')
    await openMenu(user, 'Ana')
    expect(screen.getByRole('menuitem', { name: enUS.nav.verPerfilPublico })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: enUS.nav.editarPerfil })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: enUS.nav.painel })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: enUS.nav.signOut })).toBeInTheDocument()
  })
})
