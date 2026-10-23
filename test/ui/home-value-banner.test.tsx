import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Faixa da home para quem não entrou (#472): vem no HTML de todos (pendente pinta), some só quando a sessão
 * mostra uma conta, pinta a frase do `indice` que a home sorteou e leva ao cadastro do idioma da página.
 */

vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

import { LocaleProvider } from '@/i18n/provider'
import type { Locale } from '@/i18n/locale'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { HomeValueBanner } from '@/components/recipe/home-value-banner'
import { sortearFaixa } from '@/domain/faixa-home'

function banner(indice: number, locale: Locale = 'pt-BR') {
  return (
    <LocaleProvider initialLocale={locale}>
      <HomeValueBanner indice={indice} />
    </LocaleProvider>
  )
}

afterEach(() => {
  cleanup()
  authMock.session = { data: null, isPending: false, error: null }
})

describe('textos da faixa', () => {
  it('títulos, textos e botões têm o mesmo tamanho nos dois idiomas', () => {
    const total = ptBR.faixaHome.titulos.length
    expect(total).toBeGreaterThan(1)
    for (const m of [ptBR, enUS]) {
      expect(m.faixaHome.titulos).toHaveLength(total)
      expect(m.faixaHome.textos).toHaveLength(total)
      expect(m.faixaHome.botoes).toHaveLength(total)
    }
  })

  it('nenhum texto ao usuário fala em "bilíngue"', () => {
    const tudo = [ptBR, enUS].flatMap((m) => [...m.faixaHome.titulos, ...m.faixaHome.textos, ...m.auth.vantagens])
    for (const t of tudo) expect(t.toLowerCase()).not.toMatch(/bil[ií]ngu|bilingual/)
  })
})

describe('sortearFaixa', () => {
  it('cobre todos os índices e nunca sai da faixa', () => {
    expect(sortearFaixa(3, () => 0)).toBe(0)
    expect(sortearFaixa(3, () => 0.5)).toBe(1)
    expect(sortearFaixa(3, () => 0.9999)).toBe(2)
    expect(sortearFaixa(3, () => 1)).toBe(2)
    expect(sortearFaixa(3, () => -0.1)).toBe(0)
  })
})

describe('HomeValueBanner', () => {
  it.each([0, 1, 2])('visitante: mostra a frase %i com o botão para o cadastro', (i) => {
    render(banner(i))
    const faixa = screen.getByRole('region', { name: ptBR.faixaHome.titulos[i] })
    expect(faixa).toHaveTextContent(ptBR.faixaHome.textos[i]!)
    expect(screen.getByRole('link', { name: ptBR.faixaHome.botoes[i] })).toHaveAttribute('href', '/pt-BR/sign-up')
  })

  it('sessão pendente (SSR e hidratação): mostra, igual ao HTML do servidor', () => {
    authMock.session = { data: null, isPending: true, error: null }
    render(banner(1))
    expect(screen.getByRole('heading', { level: 2, name: ptBR.faixaHome.titulos[1] })).toBeInTheDocument()
  })

  it('erro ao ler a sessão: mostra', () => {
    authMock.session = { data: null, isPending: false, error: new Error('rede') }
    render(banner(0))
    expect(screen.getByRole('heading', { level: 2, name: ptBR.faixaHome.titulos[0] })).toBeInTheDocument()
  })

  it('logado: some quando a sessão resolve com uma conta', () => {
    authMock.session = { data: null, isPending: true, error: null }
    const { rerender, container } = render(banner(2))
    expect(container).not.toBeEmptyDOMElement()
    authMock.session = { data: { user: { id: 'u1' } }, isPending: false, error: null }
    rerender(banner(2))
    expect(container).toBeEmptyDOMElement()
  })

  it('em inglês, o texto e o link seguem o idioma da página', () => {
    render(banner(0, 'en-US'))
    expect(screen.getByRole('heading', { level: 2, name: enUS.faixaHome.titulos[0] })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: enUS.faixaHome.botoes[0] })).toHaveAttribute('href', '/en-US/sign-up')
  })
})
