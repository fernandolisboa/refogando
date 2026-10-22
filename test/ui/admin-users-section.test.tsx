import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Lista de Usuários do Console (aba "Usuários", admin-only). Teste de COMPONENTE jsdom (seam #54): `fetch`
 * mockado no shape REAL de `GET /api/admin/users` e `PUT /api/admin/roles`. Cobre: tira de atalhos com as
 * contagens, linhas com email/situação/papel, troca de atalho e busca (com debounce) refazendo a consulta,
 * gaveta de detalhes, aplicar papel (PUT + recarga), trava do próprio papel e erro de carga + retry.
 *
 * Em jsdom a tabela (md+) e a lista do celular estão AMBAS no DOM (o CSS não esconde nada), então os
 * botões de cada conta aparecem duas vezes: pegamos o primeiro.
 */

const session = vi.hoisted(() => ({ id: 'me' as string | null }))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: session.id ? { user: { id: session.id } } : null }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { UsersSection } from '@/components/admin/users-section'
import type { AdminUserListItem, AdminUserListPage } from '@/domain/admin-user-list'

const A = ptBR.admin

function user(over: Partial<AdminUserListItem>): AdminUserListItem {
  return {
    id: 'u1',
    name: 'Ana Souza',
    handle: 'anasouza',
    email: 'ana@exemplo.com',
    image: null,
    role: 'usuario',
    plan: 'free',
    status: 'ativa',
    emailVerified: true,
    locale: 'pt-BR',
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    lastSeenAt: null,
    pendingSignupAt: null,
    pendingPurgeAt: null,
    deletedAt: null,
    imageGenBlocked: false,
    recipeCount: 3,
    publicRecipeCount: 1,
    ...over,
  }
}

function page(users: AdminUserListItem[], total = users.length): AdminUserListPage {
  return {
    users,
    total,
    page: 1,
    pageSize: 25,
    counts: { todos: 42, novos: 5, 'sem-papel': 38, equipe: 4, pendentes: 1, pro: 2, desativadas: 3 },
  }
}

type Reply = { ok: boolean; status: number; body: unknown }

/** fetch por método; o GET da lista responde pela função (recebe a URL), o PUT por fila. */
function mockFetch(list: (url: URL) => Reply, put: Reply[] = []) {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    let r: Reply
    if (method === 'GET' && url.pathname === '/api/admin/users') r = list(url)
    else if (method === 'PUT' && url.pathname === '/api/admin/roles') r = put.shift() ?? { ok: true, status: 200, body: {} }
    else throw new Error(`fetch não mockado: ${method} ${url.pathname}`)
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderSection() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <UsersSection />
    </LocaleProvider>,
  )
}

const ok = (body: unknown): Reply => ({ ok: true, status: 200, body })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  session.id = 'me'
})

describe('UsersSection — lista', () => {
  it('mostra os atalhos com contagem e as contas com email, situação e papel', async () => {
    mockFetch(() =>
      ok(
        page([
          user({}),
          user({
            id: 'u2',
            name: 'Caio Lima',
            handle: 'pendente-abc',
            email: 'caio@exemplo.com',
            status: 'pendente',
            emailVerified: false,
            pendingPurgeAt: new Date(Date.now() + 10 * 3600_000 - 60_000).toISOString(),
          }),
          user({ id: 'u3', name: 'Bia Reis', email: 'bia@exemplo.com', role: 'curador', plan: 'pro' }),
        ]),
      ),
    )
    renderSection()

    const presets = screen.getByRole('group', { name: A.usuariosAtalhosAria })
    expect(await within(presets).findByRole('button', { name: `${A.usuariosPresetTodos} 42` })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(presets).getByRole('button', { name: `${A.usuariosPresetSemPapel} 38` })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    const table = screen.getByRole('table')
    expect(within(table).getByText('ana@exemplo.com')).toBeInTheDocument()
    expect(within(table).getByText(A.usuariosStatusPendenteExpira.replace('{h}', '10'))).toBeInTheDocument()
    expect(within(table).getByText(A.papelCurador)).toBeInTheDocument()
    expect(within(table).getAllByText(A.usuariosSemSessao)).toHaveLength(3)
    expect(screen.getByText(A.usuariosTotal.replace('{n}', '3'))).toBeInTheDocument()
  })

  it('trocar o atalho e buscar refazem a consulta (página 1, termo com debounce)', async () => {
    const fetchMock = mockFetch(() => ok(page([user({})])))
    renderSection()
    const u = userEvent.setup()
    const presets = screen.getByRole('group', { name: A.usuariosAtalhosAria })

    await u.click(await within(presets).findByRole('button', { name: new RegExp(A.usuariosPresetPendentes) }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('preset=pendentes'))).toBe(true),
    )

    await u.type(screen.getByRole('searchbox', { name: A.usuariosBuscaLabel }), '@ana')
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => {
          const q = new URL(String(url), 'http://x').searchParams
          return q.get('q') === '@ana' && q.get('preset') === 'pendentes' && q.get('page') === '1'
        }),
      ).toBe(true),
    )
    // O debounce não dispara uma consulta por tecla.
    const withQ = fetchMock.mock.calls.filter(([url]) => String(url).includes('q='))
    expect(withQ.length).toBe(1)
  })

  it('lista vazia e erro de carga com "Tentar de novo"', async () => {
    let fail = true
    mockFetch(() => (fail ? { ok: false, status: 500, body: {} } : ok(page([]))))
    renderSection()
    expect(await screen.findByRole('alert')).toHaveTextContent(A.usuariosErroCarregar)
    fail = false
    await userEvent.setup().click(screen.getByRole('button', { name: A.usuariosTentarDeNovo }))
    expect(await screen.findByText(A.usuariosVazio)).toBeInTheDocument()
  })
})

describe('UsersSection — gaveta de detalhes e papel', () => {
  it('abre os detalhes e aplica o papel novo (PUT + recarga da lista)', async () => {
    const fetchMock = mockFetch(() => ok(page([user({})])), [ok({ userId: 'u1', role: 'curador' })])
    renderSection()
    const u = userEvent.setup()

    const [open] = await screen.findAllByRole('button', {
      name: A.usuariosAbrirDetalhes.replace('{nome}', 'Ana Souza'),
    })
    await u.click(open)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('ana@exemplo.com')).toBeInTheDocument()
    expect(within(dialog).getByText('u1')).toBeInTheDocument()
    expect(within(dialog).getByText(A.usuariosDetalheReceitasValor.replace('{n}', '3').replace('{p}', '1'))).toBeInTheDocument()

    const apply = within(dialog).getByRole('button', { name: A.aplicarPapel })
    expect(apply).toBeDisabled() // nada mudou ainda
    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.papelCurador) }))
    expect(apply).toBeEnabled()
    const before = fetchMock.mock.calls.length
    await u.click(apply)

    expect(await within(dialog).findByRole('status')).toHaveTextContent(A.promovido)
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ userId: 'u1', role: 'curador' })
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before + 1)) // recarregou
  })

  it('erro papel_proprio do servidor vira mensagem, não sucesso', async () => {
    mockFetch(() => ok(page([user({})])), [{ ok: false, status: 400, body: { error: 'papel_proprio' } }])
    renderSection()
    const u = userEvent.setup()
    const [open] = await screen.findAllByRole('button', { name: A.usuariosAbrirDetalhes.replace('{nome}', 'Ana Souza') })
    await u.click(open)
    const dialog = await screen.findByRole('dialog')
    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.papelAdmin) }))
    await u.click(within(dialog).getByRole('button', { name: A.aplicarPapel }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(A.usuariosPapelProprio)
  })

  it('a própria conta e conta desativada não têm o papel editável', async () => {
    session.id = 'u1'
    mockFetch(() =>
      ok(page([user({}), user({ id: 'u9', name: 'Zé Inativo', status: 'desativada', deletedAt: new Date().toISOString() })])),
    )
    renderSection()
    const u = userEvent.setup()

    const [mine] = await screen.findAllByRole('button', { name: A.usuariosAbrirDetalhes.replace('{nome}', 'Ana Souza') })
    await u.click(mine)
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(A.usuariosPapelProprio)).toBeInTheDocument()
    for (const radio of within(dialog).getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(within(dialog).queryByRole('link', { name: new RegExp(A.usuariosVerPerfil) })).toHaveAttribute(
      'href',
      '/u/anasouza',
    )
    await u.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const [other] = screen.getAllByRole('button', { name: A.usuariosAbrirDetalhes.replace('{nome}', 'Zé Inativo') })
    await u.click(other)
    dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(A.usuariosPapelContaInativa)).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: new RegExp(A.usuariosVerPerfil) })).toBeNull()
  })
})
