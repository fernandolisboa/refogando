import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Tour guiado (ADR-0039): abre sozinho para conta nova na home, uma vez; dispensável em qualquer passo
 * (Agora não / Pular / X / Esc), grava o desfecho por usuário no localStorage e reabre por pedido da
 * página /guia (`requestTourStart`), inclusive para o Visitante (sem os passos só-logados).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const nav = vi.hoisted(() => ({ pathname: '/pt-BR' as string | null }))
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
import { GuidedTour } from '@/components/onboarding/guided-tour'
import { requestTourStart } from '@/components/onboarding/tour-signal'
import { tourStorageKey } from '@/domain/onboarding-tour'

const t = ptBR.tour
const DAY = 24 * 60 * 60 * 1000

function loggedAs(createdAt: Date | string) {
  return {
    data: { user: { id: 'u1', name: 'Ana', email: 'a@b.c', role: 'user', handle: 'ana', createdAt } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: () => {},
  }
}

function renderTour() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <GuidedTour />
    </LocaleProvider>,
  )
}

const findTour = (title: string) => screen.findByRole('dialog', { name: title }, { timeout: 3000 })

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

afterEach(() => {
  authMock.current = authMock.anon
  nav.pathname = '/pt-BR'
})

describe('GuidedTour — abertura automática', () => {
  it('conta nova na home: abre nas boas-vindas; "Agora não" fecha e grava dismissed', async () => {
    authMock.current = loggedAs(new Date())
    const user = userEvent.setup()
    renderTour()
    const dialog = await findTour(t.boasVindasTitulo)
    expect(dialog).toHaveTextContent('Passo 1 de 7')
    await user.click(screen.getByRole('button', { name: t.agoraNao }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('u1'))).toBe('dismissed')
  })

  it('percorre todos os passos e "Concluir" grava done', async () => {
    authMock.current = loggedAs(new Date().toISOString())
    const user = userEvent.setup()
    renderTour()
    await findTour(t.boasVindasTitulo)
    await user.click(screen.getByRole('button', { name: t.comecar }))
    for (const title of [t.buscaTitulo, t.criarTitulo, t.salvosTitulo, t.cardapioTitulo, t.contaTitulo]) {
      await findTour(title)
      await user.click(screen.getByRole('button', { name: t.proximo }))
    }
    await findTour(t.fimTitulo)
    expect(screen.getByRole('link', { name: t.verGuia })).toHaveAttribute('href', '/guia')
    await user.click(screen.getByRole('button', { name: t.concluir }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('u1'))).toBe('done')
  })

  it('"Voltar" retorna ao passo anterior', async () => {
    authMock.current = loggedAs(new Date())
    const user = userEvent.setup()
    renderTour()
    await findTour(t.boasVindasTitulo)
    await user.click(screen.getByRole('button', { name: t.comecar }))
    await findTour(t.buscaTitulo)
    await user.click(screen.getByRole('button', { name: t.proximo }))
    await findTour(t.criarTitulo)
    await user.click(screen.getByRole('button', { name: t.voltar }))
    await findTour(t.buscaTitulo)
  })

  it('Esc no meio do tour dispensa', async () => {
    authMock.current = loggedAs(new Date())
    const user = userEvent.setup()
    renderTour()
    await findTour(t.boasVindasTitulo)
    await user.click(screen.getByRole('button', { name: t.comecar }))
    await findTour(t.buscaTitulo)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('u1'))).toBe('dismissed')
  })

  it('"Pular tour" e o X também dispensam', async () => {
    authMock.current = loggedAs(new Date())
    const user = userEvent.setup()
    const { unmount } = renderTour()
    await findTour(t.boasVindasTitulo)
    await user.click(screen.getByRole('button', { name: t.comecar }))
    await findTour(t.buscaTitulo)
    await user.click(screen.getByRole('button', { name: t.pular }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('u1'))).toBe('dismissed')
    unmount()

    window.localStorage.clear()
    renderTour()
    await findTour(t.boasVindasTitulo)
    await user.click(screen.getByRole('button', { name: t.fechar }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('u1'))).toBe('dismissed')
  })

  it('já visto neste dispositivo ⇒ não abre', async () => {
    window.localStorage.setItem(tourStorageKey('u1'), 'done')
    authMock.current = loggedAs(new Date())
    renderTour()
    await new Promise((r) => setTimeout(r, 900))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('conta antiga ⇒ não abre', async () => {
    authMock.current = loggedAs(new Date(Date.now() - 30 * DAY))
    renderTour()
    await new Promise((r) => setTimeout(r, 900))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('fora da home ⇒ não abre', async () => {
    nav.pathname = '/pt-BR/me/saved'
    authMock.current = loggedAs(new Date())
    renderTour()
    await new Promise((r) => setTimeout(r, 900))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Visitante ⇒ nunca abre sozinho', async () => {
    renderTour()
    await new Promise((r) => setTimeout(r, 900))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('GuidedTour — pedido do /guia', () => {
  it('Visitante na home: o pedido abre o tour sem os passos só-logados', async () => {
    const user = userEvent.setup()
    renderTour()
    act(() => requestTourStart())
    const dialog = await findTour(t.boasVindasTitulo)
    expect(dialog).toHaveTextContent('Passo 1 de 5')
    await user.click(screen.getByRole('button', { name: t.comecar }))
    await findTour(t.buscaTitulo)
    await user.click(screen.getByRole('button', { name: t.proximo }))
    await findTour(t.criarTitulo)
    await user.click(screen.getByRole('button', { name: t.proximo }))
    // Pula direto para a conta: Salvos e Cardápio não existem para o Visitante.
    const conta = await findTour(t.contaTitulo)
    expect(conta).toHaveTextContent(t.contaTextoVisitante)
  })

  it('pedido feito em outra página abre ao chegar na home, uma vez', async () => {
    nav.pathname = '/pt-BR/guia'
    authMock.current = loggedAs(new Date(Date.now() - 400 * DAY))
    window.localStorage.setItem(tourStorageKey('u1'), 'dismissed')
    const { rerender } = renderTour()
    act(() => requestTourStart())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    nav.pathname = '/pt-BR'
    rerender(
      <LocaleProvider initialLocale="pt-BR">
        <GuidedTour />
      </LocaleProvider>,
    )
    await findTour(t.boasVindasTitulo)
    expect(window.sessionStorage.getItem('refogando:tour:start')).toBeNull()
  })

  it('dispensar depois de já ter concluído não rebaixa o registro', async () => {
    window.localStorage.setItem(tourStorageKey('u1'), 'done')
    authMock.current = loggedAs(new Date())
    const user = userEvent.setup()
    renderTour()
    act(() => requestTourStart())
    await findTour(t.boasVindasTitulo)
    await user.click(screen.getByRole('button', { name: t.agoraNao }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.localStorage.getItem(tourStorageKey('u1'))).toBe('done')
  })
})

describe('GuidedTour — destaque', () => {
  it('com a âncora visível, destaca o alvo; sem ela, cartão centrado com a tela escurecida', async () => {
    // Âncora "busca" com caixa de verdade (o jsdom não faz layout: simulamos o rect).
    const anchor = document.createElement('div')
    anchor.setAttribute('data-tour', 'busca')
    anchor.getBoundingClientRect = () => ({ top: 20, left: 100, width: 300, height: 40, right: 400, bottom: 60, x: 100, y: 20, toJSON: () => ({}) })
    anchor.getClientRects = () => [anchor.getBoundingClientRect()] as unknown as DOMRectList
    document.body.appendChild(anchor)
    try {
      const user = userEvent.setup()
      renderTour()
      act(() => requestTourStart())
      await findTour(t.boasVindasTitulo)
      expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: t.comecar }))
      await findTour(t.buscaTitulo)
      const spot = await screen.findByTestId('tour-spotlight')
      expect(spot.style.top).toBe('14px')
      expect(spot.style.width).toBe('312px')
      // "criar" não tem âncora visível aqui ⇒ centrado, sem destaque.
      await user.click(screen.getByRole('button', { name: t.proximo }))
      await findTour(t.criarTitulo)
      await waitFor(() => expect(screen.queryByTestId('tour-spotlight')).not.toBeInTheDocument())
    } finally {
      anchor.remove()
    }
  })

  it('no celular (só o botão do menu visível) avisa que o item fica no menu', async () => {
    const menu = document.createElement('button')
    menu.setAttribute('data-tour', 'menu-mobile')
    menu.getBoundingClientRect = () => ({ top: 10, left: 300, width: 36, height: 36, right: 336, bottom: 46, x: 300, y: 10, toJSON: () => ({}) })
    menu.getClientRects = () => [menu.getBoundingClientRect()] as unknown as DOMRectList
    document.body.appendChild(menu)
    try {
      const user = userEvent.setup()
      renderTour()
      act(() => requestTourStart())
      await findTour(t.boasVindasTitulo)
      await user.click(screen.getByRole('button', { name: t.comecar }))
      await findTour(t.buscaTitulo)
      await user.click(screen.getByRole('button', { name: t.proximo }))
      const criar = await findTour(t.criarTitulo)
      await waitFor(() => expect(criar).toHaveTextContent(t.noMenu))
    } finally {
      menu.remove()
    }
  })
})
