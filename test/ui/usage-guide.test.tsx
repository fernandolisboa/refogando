import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Página "Como usar" (/guia, ADR-0039): todas as seções do guia, um índice com âncoras e o botão que
 * refaz o tour guiado (deixa o pedido no sessionStorage e navega para a home).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR/guia',
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { UsageGuide } from '@/components/onboarding/usage-guide'
import { TOUR_START_EVENT, TOUR_START_KEY } from '@/components/onboarding/tour-signal'

const g = ptBR.guia

afterEach(() => {
  router.push.mockReset()
  window.sessionStorage.clear()
})

describe('UsageGuide (/guia)', () => {
  it('renderiza o título e todas as seções, com um índice que aponta para cada uma', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <UsageGuide />
      </LocaleProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: g.titulo })).toBeInTheDocument()
    const titles = [
      g.buscarTitulo,
      g.criarTitulo,
      g.receitaTitulo,
      g.salvosTitulo,
      g.listaTitulo,
      g.cardapioTitulo,
      g.comunidadeTitulo,
      g.contaTitulo,
    ]
    const indice = screen.getByRole('navigation', { name: g.indice })
    for (const title of titles) {
      const heading = screen.getByRole('heading', { level: 2, name: title })
      const section = heading.closest('section')!
      expect(within(indice).getByRole('link', { name: title })).toHaveAttribute('href', `#${section.id}`)
    }
    for (const item of g.cardapioItens) expect(screen.getByText(item)).toBeInTheDocument()
  })

  it('"Fazer o tour guiado" deixa o pedido e vai para a home', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    window.addEventListener(TOUR_START_EVENT, onStart)
    render(
      <LocaleProvider initialLocale="pt-BR">
        <UsageGuide />
      </LocaleProvider>,
    )
    await user.click(screen.getByRole('button', { name: g.tourBotao }))
    expect(Number(window.sessionStorage.getItem(TOUR_START_KEY))).toBeGreaterThan(0)
    expect(onStart).toHaveBeenCalledOnce()
    expect(router.push).toHaveBeenCalledWith('/')
    window.removeEventListener(TOUR_START_EVENT, onStart)
  })

  it('en-US: o guia segue o idioma', () => {
    render(
      <LocaleProvider initialLocale="en-US">
        <UsageGuide />
      </LocaleProvider>,
    )
    expect(screen.getByRole('heading', { level: 1, name: enUS.guia.titulo })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.guia.tourBotao })).toBeInTheDocument()
  })
})
