import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * "Eliminar conta" na gaveta do Console → Usuários (#606). Teste de COMPONENTE jsdom: `fetch` mockado no shape REAL
 * de `GET /api/admin/users` e `POST /api/admin/users/[id]/erasure`. Cobre: a trava da própria conta e da conta de
 * admin, a seção escondida para conta inativa, o diálogo (foco em Cancelar, motivo, opções por motivo, @ digitado),
 * o corpo do POST, o desfecho na gaveta (identidade anonimizada + recarga), o e-mail que não saiu, o 403
 * `reautenticar` e o mapa dos erros.
 */

const session = vi.hoisted(() => ({ id: 'me' as string | null }))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: session.id ? { user: { id: session.id } } : null }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { UsersSection } from '@/components/admin/users-section'
import { erasedIdentity } from '@/domain/account-erasure'
import type { AdminUserListItem, AdminUserListPage } from '@/domain/admin-user-list'

const A = ptBR.admin
const ID = '7d1f3c2a-1111-4222-8333-944455556666'

function user(over: Partial<AdminUserListItem> = {}): AdminUserListItem {
  return {
    id: ID,
    name: 'Ana Souza',
    handle: 'anasouza',
    email: 'ana@exemplo.com',
    image: null,
    role: 'usuario',
    plan: 'free',
    status: 'ativa',
    locale: 'pt-BR',
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    lastSeenAt: null,
    pendingPurgeAt: null,
    deletedAt: null,
    imageGenBlocked: false,
    recipeCount: 3,
    publicRecipeCount: 1,
    ...over,
  }
}

function page(users: AdminUserListItem[]): AdminUserListPage {
  return {
    users,
    total: users.length,
    page: 1,
    pageSize: 25,
    counts: { todos: 1, novos: 1, 'sem-papel': 1, equipe: 0, pendentes: 0, pro: 0, desativadas: 0 },
  }
}

type Reply = { ok: boolean; status: number; body: unknown }

function mockFetch(users: AdminUserListItem[], erasure: Reply[] = []) {
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    let r: Reply
    if (method === 'GET' && url.pathname === '/api/admin/users') r = { ok: true, status: 200, body: page(users) }
    else if (method === 'POST' && url.pathname === `/api/admin/users/${ID}/erasure`) {
      r = erasure.shift() ?? { ok: true, status: 200, body: { ok: true, emailSent: true } }
    } else throw new Error(`fetch não mockado: ${method} ${url.pathname}`)
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  session.id = 'me'
})

async function openDrawer(name = 'Ana Souza') {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <UsersSection />
    </LocaleProvider>,
  )
  const u = userEvent.setup()
  const [open] = await screen.findAllByRole('button', { name: A.usuariosAbrirDetalhes.replace('{nome}', name) })
  await u.click(open)
  const drawer = await screen.findByRole('dialog')
  return { u, drawer }
}

async function openCloseDialog() {
  const ctx = await openDrawer()
  await ctx.u.click(within(ctx.drawer).getByRole('button', { name: A.usuariosEliminarBotao }))
  const dialog = await screen.findByRole('dialog', { name: A.usuariosEliminarDialogoTitulo.replace('{nome}', 'Ana Souza') })
  return { ...ctx, dialog }
}

describe('Eliminar conta — travas', () => {
  it('a própria conta: botão desabilitado, com o motivo', async () => {
    session.id = ID
    mockFetch([user()])
    const { drawer } = await openDrawer()
    const btn = within(drawer).getByRole('button', { name: A.usuariosEliminarBotao })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription(A.usuariosEliminarTravaPropria)
  })

  it('conta de admin: botão desabilitado, pedindo para mudar o papel antes', async () => {
    mockFetch([user({ role: 'admin' })])
    const { drawer } = await openDrawer()
    const btn = within(drawer).getByRole('button', { name: A.usuariosEliminarBotao })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription(A.usuariosEliminarTravaAdmin)
  })

  it('conta desativada ou eliminada: sem a seção', async () => {
    mockFetch([user({ status: 'eliminada', deletedAt: new Date().toISOString() })])
    const { drawer } = await openDrawer()
    expect(within(drawer).queryByRole('button', { name: A.usuariosEliminarBotao })).toBeNull()
  })
})

describe('Eliminar conta — diálogo', () => {
  it('violação: foco em Cancelar, confirma só com o motivo e o @, manda o corpo certo e mostra o desfecho', async () => {
    const fetchMock = mockFetch([user()])
    const { u, drawer, dialog } = await openCloseDialog()
    expect(within(dialog).getByRole('button', { name: A.usuariosEliminarCancelar })).toHaveFocus()

    const confirm = within(dialog).getByRole('button', { name: A.usuariosEliminarConfirmar })
    expect(confirm).toBeDisabled()
    // Nenhuma opção antes do motivo.
    expect(within(dialog).queryByRole('checkbox')).toBeNull()

    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.usuariosEliminarMotivoViolacao) }))
    const avisar = within(dialog).getByRole('checkbox', { name: A.usuariosEliminarAvisar })
    expect(avisar).toBeChecked()
    expect(within(dialog).queryByRole('checkbox', { name: A.usuariosEliminarRemoverPublico })).toBeNull()
    expect(confirm).toBeDisabled()

    const field = within(dialog).getByLabelText(A.usuariosEliminarConfirmarLabel.replace('{handle}', '@anasouza'))
    await u.type(field, 'anasouz')
    expect(confirm).toBeDisabled()
    await u.type(field, 'a')
    expect(confirm).toBeEnabled()

    const before = fetchMock.mock.calls.length
    await u.click(confirm)

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: A.usuariosEliminarDialogoTitulo.replace('{nome}', 'Ana Souza') })).toBeNull(),
    )
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      reason: 'violacao_grave',
      removePublicContent: false,
      notify: true,
      confirmHandle: 'anasouza',
    })
    expect(await within(drawer).findByRole('status')).toHaveTextContent(A.usuariosEliminarFeito)
    // A gaveta mostra o que sobrou: identidade anonimizada, sem o e-mail real.
    const anon = erasedIdentity(ID)
    expect(within(drawer).getByText(anon.email)).toBeInTheDocument()
    expect(within(drawer).queryByText('ana@exemplo.com')).toBeNull()
    expect(within(drawer).getByText(A.usuariosStatusEliminada)).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: A.usuariosEliminarBotao })).toBeNull()
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before + 1)) // recarregou a lista
  })

  it('menor de 16: o público sai sempre (nota, sem opção), sem "avisar"; o status de sucesso recebe o foco', async () => {
    const fetchMock = mockFetch([user()], [{ ok: true, status: 200, body: { ok: true, emailSent: false } }])
    const { u, drawer, dialog } = await openCloseDialog()
    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.usuariosEliminarMotivoMenor) }))
    expect(within(dialog).getByText(A.usuariosEliminarRemoverPublico)).toBeInTheDocument()
    expect(within(dialog).getByText(A.usuariosEliminarRemoverPublicoAjuda)).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).toBeNull()
    await u.type(within(dialog).getByRole('textbox'), '@AnaSouza')
    await u.click(within(dialog).getByRole('button', { name: A.usuariosEliminarConfirmar }))

    const status = await within(drawer).findByRole('status')
    expect(status).toHaveTextContent(A.usuariosEliminarFeito)
    // Sem foco perdido: o diálogo fecha e o leitor de tela lê o resultado (o botão de origem sumiu).
    await waitFor(() => expect(status).toHaveFocus())
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ reason: 'menor_16', removePublicContent: true, notify: false })
    // Não pediu aviso, então não há o que lamentar.
    expect(within(drawer).queryByText(A.usuariosEliminarEmailNaoEnviado)).toBeNull()
  })

  it('violação com aviso que não saiu: a gaveta pede para avisar pelo canal', async () => {
    mockFetch([user()], [{ ok: true, status: 200, body: { ok: true, emailSent: false } }])
    const { u, drawer, dialog } = await openCloseDialog()
    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.usuariosEliminarMotivoViolacao) }))
    await u.type(within(dialog).getByRole('textbox'), 'anasouza')
    await u.click(within(dialog).getByRole('button', { name: A.usuariosEliminarConfirmar }))
    expect(await within(drawer).findByText(A.usuariosEliminarEmailNaoEnviado)).toBeInTheDocument()
  })

  it('403 reautenticar: nada sai, o aviso leva a entrar de novo e trava o botão', async () => {
    mockFetch([user()], [{ ok: false, status: 403, body: { error: 'reautenticar' } }])
    const { u, dialog } = await openCloseDialog()
    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.usuariosEliminarMotivoViolacao) }))
    await u.type(within(dialog).getByRole('textbox'), 'anasouza')
    await u.click(within(dialog).getByRole('button', { name: A.usuariosEliminarConfirmar }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(A.usuariosEliminarReautenticar)
    expect(alert).toHaveFocus()
    expect(within(alert).getByRole('link', { name: A.usuariosEliminarReautenticarLink })).toHaveAttribute(
      'href',
      `/sign-in?returnTo=${encodeURIComponent('/admin/users')}`,
    )
    expect(within(dialog).getByRole('button', { name: A.usuariosEliminarConfirmar })).toBeDisabled()
  })

  it('erros do servidor viram a mensagem do código; desconhecido, a genérica', async () => {
    mockFetch(
      [user()],
      [
        { ok: false, status: 409, body: { error: 'conta_inativa' } },
        { ok: false, status: 500, body: {} },
      ],
    )
    const { u, dialog } = await openCloseDialog()
    await u.click(within(dialog).getByRole('radio', { name: new RegExp(A.usuariosEliminarMotivoViolacao) }))
    await u.type(within(dialog).getByRole('textbox'), 'anasouza')
    const confirm = within(dialog).getByRole('button', { name: A.usuariosEliminarConfirmar })
    await u.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(A.usuariosEliminarErroInativa)
    await u.click(confirm)
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(A.usuariosEliminarErro))
  })
})
