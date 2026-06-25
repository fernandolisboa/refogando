import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * RolesSection (#63/#269) — seam jsdom (#54). O fluxo virou BUSCA → selecionar candidato →
 * atribuir: o componente bate em GET /api/admin/users/search (debounce de timers REAIS — usamos
 * `findBy*` que espera os 300ms, NÃO fake timers) e depois no PUT /api/admin/roles INALTERADO. As
 * asserções de discriminação de erro por CHAVE do corpo (papel_invalido / papel_nao_aplicado em 404
 * E em 400) seguem valendo, agora alimentadas pelo userId do candidato escolhido.
 */
type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }

/** Mock de fetch por handler (url, method) → resposta — a URL de busca carrega `?q=` variável. */
function mockFetch(handler: (url: string, method: string) => FetchResult) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    const r = handler(url, method)
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RolesSection } from '@/components/admin/roles-section'

const A = ptBR.admin
const ANA = { id: 'u-ana', name: 'Ana', handle: 'ana', image: null, role: 'usuario', email: 'ana@x.com' }

function renderRoles() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RolesSection />
    </LocaleProvider>,
  )
}

/** Roteia a busca (results) e, opcionalmente, o PUT de papéis. */
function routes(searchResults: unknown[], rolesPut: FetchResult = { ok: true, status: 200, body: {} }) {
  return (url: string, method: string): FetchResult => {
    if (method === 'GET' && url.includes('/api/admin/users/search')) {
      return { ok: true, status: 200, body: { results: searchResults } }
    }
    if (method === 'PUT' && url === '/api/admin/roles') return rolesPut
    throw new Error(`fetch não mockado: ${method} ${url}`)
  }
}

async function searchAndPick(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(A.buscaUsuarioLabel), 'ana')
  // findBy espera o debounce (300ms) + a resposta mockada resolver.
  await user.click(await screen.findByRole('button', { name: /Ana/ }))
}

describe('RolesSection (#269) — busca → selecionar → atribuir', () => {
  it('digitar busca e mostra candidatos com nome/@handle/email (admin)', async () => {
    mockFetch(routes([ANA]))
    const user = userEvent.setup()
    renderRoles()
    await user.type(screen.getByLabelText(A.buscaUsuarioLabel), 'ana')
    expect(await screen.findByRole('button', { name: /Ana/ })).toBeInTheDocument()
    expect(screen.getByText(/ana@x\.com/)).toBeInTheDocument()
    // Anúncio do COUNT na região viva (a11y — a lista em si não é viva).
    expect(screen.getByText(A.buscaUsuarioContagem.replace('{n}', '1'))).toBeInTheDocument()
  })

  it('sem usuário selecionado NÃO há botão "Aplicar papel"', () => {
    mockFetch(routes([]))
    renderRoles()
    expect(screen.queryByRole('button', { name: A.aplicarPapel })).toBeNull()
  })

  it('selecionar candidato → atribuir → PUT /api/admin/roles com o userId do candidato → sucesso', async () => {
    const fetchMock = mockFetch(
      routes([ANA], { ok: true, status: 200, body: { userId: 'u-ana', role: 'curador' } }),
    )
    const user = userEvent.setup()
    renderRoles()
    await searchAndPick(user)
    // Caption acessível do usuário escolhido (a11y).
    expect(screen.getByText(A.usuarioSelecionado)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText(A.papelLabel), 'curador')
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))

    const put = fetchMock.mock.calls.find((c) => (c[1]?.method ?? 'GET') === 'PUT')!
    expect(String(put[0])).toBe('/api/admin/roles')
    expect(JSON.parse(String((put[1] as RequestInit).body))).toEqual({
      userId: 'u-ana',
      role: 'curador',
    })
    expect(await screen.findByText(A.promovido)).toBeInTheDocument()
  })

  it('papel_invalido (400) → mensagem de papel inválido', async () => {
    mockFetch(routes([ANA], { ok: false, status: 400, body: { error: 'papel_invalido' } }))
    const user = userEvent.setup()
    renderRoles()
    await searchAndPick(user)
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))
    expect(await screen.findByRole('alert')).toHaveTextContent(A.erroPapelInvalido)
  })

  it('papel_nao_aplicado em 404 E em 400 → MESMA mensagem (discrimina por CHAVE, não por status)', async () => {
    // 404
    const r1 = mockFetch(routes([ANA], { ok: false, status: 404, body: { error: 'papel_nao_aplicado' } }))
    const user = userEvent.setup()
    const { unmount } = renderRoles()
    await searchAndPick(user)
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))
    let alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(A.erroNaoAplicado)
    expect(alert).not.toHaveTextContent(A.erroPapelInvalido)
    expect(r1).toBeDefined()
    unmount()
    vi.unstubAllGlobals()

    // 400 com a MESMA chave → MESMA mensagem
    mockFetch(routes([ANA], { ok: false, status: 400, body: { error: 'papel_nao_aplicado' } }))
    renderRoles()
    await searchAndPick(user)
    await user.click(screen.getByRole('button', { name: A.aplicarPapel }))
    alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(A.erroNaoAplicado)
  })

  it('"Trocar" volta pra busca (sem usuário selecionado, botão Aplicar some)', async () => {
    mockFetch(routes([ANA]))
    const user = userEvent.setup()
    renderRoles()
    await searchAndPick(user)
    expect(screen.getByRole('button', { name: A.aplicarPapel })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: A.trocarUsuario }))
    expect(screen.queryByRole('button', { name: A.aplicarPapel })).toBeNull()
    expect(screen.getByLabelText(A.buscaUsuarioLabel)).toBeInTheDocument()
  })
})
