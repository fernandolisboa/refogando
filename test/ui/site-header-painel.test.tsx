import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Afordância "Painel" (#125) — atalho para o Console, visível só a curador+. A partir do #267 ela
 * NÃO vive mais na nav: migrou para o MENU DA CONTA (dropdown do avatar, dentro do AuthSlot). Então
 * aqui renderizamos o header, ABRIMOS o menu da conta (clicando no gatilho = nome do usuário) e
 * afirmamos presença/ausência do item `menuitem` "Painel" — que portaleia pro body (busca por
 * `screen`, não dentro da nav). A MATRIZ de gate de verdade (quem ENTRA no /admin) é o teste node;
 * aqui só a afordância de UI. Mock de sessão por papel; default Visitante.
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

// Usuário de teste 'X' (com handle) — o gatilho do menu da conta tem o NOME como rótulo acessível.
function sessionFor(role: string | null) {
  return {
    data: { user: { id: 'u1', name: 'X', email: 'x@y.z', role, handle: 'x', deletedAt: null } },
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

// Abre o menu da conta no cluster do desktop (gatilho = nome 'X'). O conteúdo portaleia pro body.
async function openAccountMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'X' }))
  await screen.findByRole('menu')
}

const PAINEL = ptBR.nav.painel

afterEach(() => {
  authMock.current = authMock.anon
})

describe('Header — afordância "Painel" no menu da conta, só para curador+ (#125/#267)', () => {
  it('curador VÊ o item "Painel" apontando para /admin', async () => {
    const user = userEvent.setup()
    authMock.current = sessionFor('curador')
    renderHeader()
    await openAccountMenu(user)
    const item = screen.getByRole('menuitem', { name: PAINEL })
    expect(item).toHaveAttribute('href', '/admin')
  })

  it('admin VÊ o item "Painel"', async () => {
    const user = userEvent.setup()
    authMock.current = sessionFor('admin')
    renderHeader()
    await openAccountMenu(user)
    expect(screen.getByRole('menuitem', { name: PAINEL })).toBeInTheDocument()
  })

  it('usuario NÃO vê o item "Painel" (menu aberto, item ausente)', async () => {
    const user = userEvent.setup()
    authMock.current = sessionFor('usuario')
    renderHeader()
    await openAccountMenu(user)
    expect(screen.queryByRole('menuitem', { name: PAINEL })).not.toBeInTheDocument()
  })

  it('papel desconhecido/null NÃO vê o item (fail-closed na afordância)', async () => {
    const user = userEvent.setup()

    authMock.current = sessionFor(null)
    const r1 = renderHeader()
    await openAccountMenu(user)
    expect(screen.queryByRole('menuitem', { name: PAINEL })).not.toBeInTheDocument()
    r1.unmount() // desmonta antes do 2º render pra não haver dois menus/gatilhos no DOM
    // Settle: espera o menu portaleado sumir antes do próximo render abrir o seu (flake sob carga).
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    authMock.current = sessionFor('superusuario')
    renderHeader()
    await openAccountMenu(user)
    expect(screen.queryByRole('menuitem', { name: PAINEL })).not.toBeInTheDocument()
  })

  it('anon (Visitante) NÃO tem menu de conta (só "Entrar")', () => {
    authMock.current = authMock.anon
    renderHeader()
    // Sem gatilho de conta (nome de usuário); o Visitante vê o link "Entrar".
    expect(screen.queryByRole('button', { name: 'X' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toBeInTheDocument()
    expect(screen.queryByText(PAINEL)).not.toBeInTheDocument()
  })
})
