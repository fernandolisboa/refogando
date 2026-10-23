import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Aviso de mudança dos Termos e da Política (ADR-0051), montado no layout: só para quem tem sessão e conta
 * anterior à publicação; "Entendi" grava no localStorage (por versão e por conta) e leva o foco ao `<h1>`;
 * storage bloqueado mostra o aviso e a dispensa vale na carga; o servidor/1º render não mostram nada.
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const auth = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => auth.current,
}))

import { LocaleProvider } from '@/i18n/provider'
import type { Locale } from '@/i18n/locale'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { LegalChangeNotice } from '@/components/legal/legal-change-notice'
import { AVISO_LEGAL_CONTAS_ANTES_DE_MS, avisoLegalStorageKey } from '@/domain/legal-notice'

const ANTES = new Date(AVISO_LEGAL_CONTAS_ANTES_DE_MS - 24 * 60 * 60 * 1000)
const DEPOIS = new Date(AVISO_LEGAL_CONTAS_ANTES_DE_MS + 60 * 60 * 1000)

function sessao(createdAt: Date | null, id = 'user-1') {
  return {
    data: { user: { id, createdAt }, session: {} },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: () => {},
  }
}
const ANON = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }

function renderNotice(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LegalChangeNotice />
      <main>
        <h1>Título da página</h1>
      </main>
    </LocaleProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('LegalChangeNotice (ADR-0051)', () => {
  it('conta anterior à publicação: mostra o texto, os dois links prefixados e o "Entendi"', async () => {
    auth.current = sessao(ANTES)
    renderNotice()
    expect(await screen.findByText(ptBR.avisoLegal.texto, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('note')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.termos.nome })).toHaveAttribute('href', '/pt-BR/termos')
    expect(screen.getByRole('link', { name: ptBR.privacidade.titulo })).toHaveAttribute('href', '/pt-BR/privacidade')
    expect(screen.getByRole('button', { name: ptBR.avisoLegal.fechar })).toBeInTheDocument()
  })

  it('en-US: texto e links no idioma da página', async () => {
    auth.current = sessao(ANTES)
    renderNotice('en-US')
    expect(await screen.findByText(enUS.avisoLegal.texto, { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: enUS.termos.nome })).toHaveAttribute('href', '/en-US/termos')
  })

  it('o 1º render não mostra nada (o HTML do servidor bate com o do cliente)', () => {
    auth.current = sessao(ANTES)
    const { container } = renderNotice()
    // Antes do timer da montagem: só a página.
    expect(container.querySelector('[role="note"]')).toBeNull()
  })

  it('"Entendi": some, grava a dispensa por versão e por conta, e o foco vai para o h1', async () => {
    auth.current = sessao(ANTES)
    renderNotice()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: ptBR.avisoLegal.fechar }))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(avisoLegalStorageKey('user-1'))).toBe('1')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('já dispensado neste navegador: não aparece', async () => {
    window.localStorage.setItem(avisoLegalStorageKey('user-1'), '1')
    auth.current = sessao(ANTES)
    renderNotice()
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('a dispensa de outra conta não vale para esta', async () => {
    window.localStorage.setItem(avisoLegalStorageKey('outra-conta'), '1')
    auth.current = sessao(ANTES)
    renderNotice()
    expect(await screen.findByRole('note')).toBeInTheDocument()
  })

  it('conta criada depois da publicação, visitante ou createdAt ausente: não aparece', async () => {
    for (const s of [sessao(DEPOIS), ANON, sessao(null)]) {
      auth.current = s
      const { unmount } = renderNotice()
      await new Promise((r) => setTimeout(r, 10))
      expect(screen.queryByRole('note')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('storage bloqueado: aparece e o "Entendi" esconde nesta carga', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    auth.current = sessao(ANTES)
    renderNotice()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: ptBR.avisoLegal.fechar }))
    await waitFor(() => expect(screen.queryByRole('note')).not.toBeInTheDocument())
  })
})
