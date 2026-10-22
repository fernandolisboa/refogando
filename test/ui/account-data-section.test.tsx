import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * "Seus dados" no /me/profile (#595, LGPD Art. 18 II/V/VI), pelo lado da UI: o titular baixa o export
 * (`GET /api/me/export` por fetch + blob, nome datado) e exclui a conta pelo diálogo (`POST
 * /api/me/erasure`), sem usar a API na mão. `useSession`/`signOut` e o `forgetTabs` mockados; `fetch` por URL
 * e método; `URL.createObjectURL` atribuído (o jsdom não tem); o clique na âncora do download é espionado.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean; isRefetching: boolean; refetch: () => void }
let sessionState: SessionState
const order = vi.hoisted(() => [] as string[])
const signOut = vi.hoisted(() => vi.fn(async () => {}))
const forgetTabs = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
  signOut: () => {
    order.push('signOut')
    return signOut()
  },
}))
vi.mock('@/components/nav/last-tab-store', () => ({
  forgetTabs: () => {
    order.push('forgetTabs')
    forgetTabs()
  },
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { accountExportFilename } from '@/domain/account-export'
import { AccountDataSection } from '@/components/profile/account-data-section'
import { ACCOUNT_DELETED_KEY } from '@/components/profile/account-deleted-signal'
import { stubAssign } from './reload-stub'

const m = ptBR.seusDados

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
}

type Reply = { status: number; body?: unknown } | 'throw' | Promise<{ status: number; body?: unknown }>
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** fetch por rota: `export` e `erasure` respondem com a próxima resposta da fila (a última se repete). */
function mockFetch(routes: { export?: Reply[]; erasure?: Reply[] }) {
  const calls: Call[] = []
  const queues = { export: [...(routes.export ?? [{ status: 200, body: { format: 'x' } }])], erasure: [...(routes.erasure ?? [{ status: 200, body: { ok: true } }])] }
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body })
    const key = url === '/api/me/export' ? 'export' : url === '/api/me/erasure' ? 'erasure' : null
    if (!key) throw new Error(`rota inesperada: ${method} ${url}`)
    const q = queues[key]
    const next = q.length > 1 ? q.shift()! : q[0]
    if (next === 'throw') throw new TypeError('Failed to fetch')
    const r = await next
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
      blob: async () => new Blob([JSON.stringify(r.body ?? {})], { type: 'application/json' }),
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function renderSection(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AccountDataSection />
    </LocaleProvider>,
  )
}

let clicks: Array<{ download: string; href: string }>
let loc: ReturnType<typeof stubAssign>
const createObjectURL = vi.fn((blob: Blob) => `blob:mock/${blob.size}`)
const revokeObjectURL = vi.fn()
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeEach(() => {
  sessionState = authed()
  order.length = 0
  signOut.mockReset()
  signOut.mockImplementation(async () => {})
  forgetTabs.mockReset()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  clicks = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ download: this.download, href: this.href })
  })
  const setItem = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === ACCOUNT_DELETED_KEY) order.push('markAccountDeleted')
    return setItem.call(this, k, v)
  })
  loc = stubAssign()
  loc.assign.mockImplementation(() => order.push('assign'))
  loc.reload.mockImplementation(() => order.push('reload'))
  window.sessionStorage.clear()
})
afterEach(() => {
  loc.restore()
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: m.excluir }))
  return screen.findByRole('dialog', { name: m.dialogoTitulo })
}

async function confirmErasure(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('checkbox', { name: m.entendo }))
  await user.click(within(dialog).getByRole('button', { name: m.confirmar }))
}

describe('AccountDataSection — "Seus dados" (#595)', () => {
  it('Visitante: não renderiza nada', () => {
    sessionState = guest()
    const { container } = renderSection()
    expect(container).toBeEmptyDOMElement()
  })

  it('logado: região "Seus dados" com os dois botões e os links da Política e de Seus direitos', () => {
    renderSection()
    const region = screen.getByRole('region', { name: m.titulo })
    expect(within(region).getByRole('heading', { level: 2, name: m.titulo })).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: m.baixar })).toHaveAccessibleDescription(m.baixarDica)
    expect(within(region).getByRole('button', { name: m.excluir })).toHaveAccessibleDescription(m.excluirDica)
    expect(within(region).getByRole('link', { name: ptBR.privacidade.titulo })).toHaveAttribute('href', '/privacidade')
    expect(within(region).getByRole('link', { name: ptBR.seusDireitos.titulo })).toHaveAttribute('href', '/seus-direitos')
  })

  it('baixar: GET /api/me/export, salva o arquivo com o nome datado e anuncia "Arquivo baixado."', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({})
    renderSection()
    await user.click(screen.getByRole('button', { name: m.baixar }))

    expect(await screen.findByText(m.baixado)).toBeInTheDocument()
    expect(calls).toEqual([expect.objectContaining({ url: '/api/me/export', method: 'GET' })])
    expect(clicks).toHaveLength(1)
    expect(clicks[0].download).toMatch(/^refogando-meus-dados-\d{4}-\d{2}-\d{2}\.json$/)
    expect(clicks[0].download).toBe(accountExportFilename(new Date()))
    expect(clicks[0].href).toMatch(/^blob:mock\//)
    // A URL do blob segue viva depois do clique (Safari/Firefox a leem depois).
    expect(revokeObjectURL).not.toHaveBeenCalled()
    // A âncora temporária não fica no DOM.
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('baixar: dois cliques seguidos fazem UM pedido só', async () => {
    const d = deferred<{ status: number; body?: unknown }>()
    const { calls } = mockFetch({ export: [d.promise] })
    renderSection()
    const button = screen.getByRole('button', { name: m.baixar })
    button.click()
    button.click()
    await waitFor(() => expect(screen.getByRole('button', { name: m.baixando })).toBeDisabled())
    expect(screen.getByRole('button', { name: m.baixando })).toHaveAttribute('aria-busy', 'true')
    d.resolve({ status: 200, body: {} })
    expect(await screen.findByText(m.baixado)).toBeInTheDocument()
    expect(calls).toHaveLength(1)
  })

  it('baixar: 500 ou falha de rede mostram o erro e não salvam arquivo nenhum', async () => {
    const user = userEvent.setup()
    mockFetch({ export: [{ status: 500, body: { error: 'x' } }, 'throw'] })
    renderSection()
    await user.click(screen.getByRole('button', { name: m.baixar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(m.erroBaixar)
    await user.click(screen.getByRole('button', { name: m.baixar }))
    await waitFor(() => expect(screen.getByRole('button', { name: m.baixar })).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent(m.erroBaixar)
    expect(clicks).toHaveLength(0)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('o diálogo explica o que é apagado, o que fica e oferece baixar antes', async () => {
    const user = userEvent.setup()
    mockFetch({})
    renderSection()
    const dialog = await openDialog(user)
    expect(dialog).toHaveAccessibleDescription(m.dialogoDescricao)
    for (const item of [...m.apagadoItens, ...m.mantidoItens]) {
      expect(within(dialog).getByText(item)).toBeInTheDocument()
    }
    expect(within(dialog).getByRole('heading', { name: m.apagadoTitulo })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: m.mantidoTitulo })).toBeInTheDocument()
    expect(within(dialog).getByText(m.baixarAntes)).toBeInTheDocument()
    // Foco inicial na ação menos destrutiva.
    expect(within(dialog).getByRole('button', { name: m.cancelar })).toHaveFocus()
  })

  it('"Excluir definitivamente" só libera com a caixa marcada; Cancelar fecha sem chamar nada e reabre desmarcado', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({})
    renderSection()
    let dialog = await openDialog(user)
    const confirmar = within(dialog).getByRole('button', { name: m.confirmar })
    expect(confirmar).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox', { name: m.entendo }))
    expect(confirmar).toBeEnabled()

    await user.click(within(dialog).getByRole('button', { name: m.cancelar }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls).toHaveLength(0)

    dialog = await openDialog(user)
    expect(within(dialog).getByRole('checkbox', { name: m.entendo })).not.toBeChecked()
    expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeDisabled()
  })

  it('baixar dentro do diálogo: "Arquivo baixado." ali, e some ao fechar e reabrir', async () => {
    const user = userEvent.setup()
    mockFetch({})
    renderSection()
    let dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: m.baixar }))
    expect(await within(dialog).findByText(m.baixado)).toBeInTheDocument()
    expect(clicks).toHaveLength(1)

    await user.click(within(dialog).getByRole('button', { name: m.cancelar }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    dialog = await openDialog(user)
    expect(within(dialog).queryByText(m.baixado)).not.toBeInTheDocument()
  })

  it('confirmar: POST com {confirm:true} em JSON → marca o aviso, esquece as abas, sai e recarrega a home do idioma', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch({})
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/pt-BR'))
    expect(calls).toEqual([
      expect.objectContaining({
        url: '/api/me/erasure',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { confirm: true },
      }),
    ])
    expect(order).toEqual(['markAccountDeleted', 'forgetTabs', 'signOut', 'assign'])
    expect(window.sessionStorage.getItem(ACCOUNT_DELETED_KEY)).not.toBeNull()
    expect(loc.reload).not.toHaveBeenCalled()
  })

  it('signOut que não responde (offline): sai mesmo assim depois de 3s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      signOut.mockImplementation(() => new Promise<void>(() => {}))
      mockFetch({})
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)
      await waitFor(() => expect(order).toContain('signOut'))
      expect(loc.assign).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(loc.assign).toHaveBeenCalledWith('/pt-BR')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resposta perdida: o fetch lança, a nova tentativa dá 401 nao_autenticado → a conta já foi excluída, saída normal', async () => {
    const user = userEvent.setup()
    mockFetch({ erasure: ['throw', { status: 401, body: { error: 'nao_autenticado' } }] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
    expect(order).toEqual([])
    await user.click(within(dialog).getByRole('button', { name: m.confirmar }))

    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/pt-BR'))
    expect(order).toEqual(['markAccountDeleted', 'forgetTabs', 'signOut', 'assign'])
  })

  it('401 sem resposta perdida antes (sessão morta): mostra erroSessao, sai e recarrega a página, sem o aviso de excluída', async () => {
    const user = userEvent.setup()
    mockFetch({ erasure: [{ status: 401, body: { error: 'nao_autenticado' } }] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroSessao)
    await waitFor(() => expect(loc.reload).toHaveBeenCalledOnce())
    expect(order).toEqual(['forgetTabs', 'signOut', 'reload'])
    expect(loc.assign).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem(ACCOUNT_DELETED_KEY)).toBeNull()
  })

  it('500: mostra erroExcluir, o diálogo fica aberto e o botão volta; nada de sair', async () => {
    const user = userEvent.setup()
    mockFetch({ erasure: [{ status: 500, body: { error: 'x' } }] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
    expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeEnabled()
    expect(screen.getByRole('dialog', { name: m.dialogoTitulo })).toBeInTheDocument()
    expect(signOut).not.toHaveBeenCalled()
    expect(loc.assign).not.toHaveBeenCalled()
    expect(loc.reload).not.toHaveBeenCalled()
  })

  it('enquanto exclui: Esc não fecha, o X some e o botão fica aria-busy', async () => {
    const user = userEvent.setup()
    const d = deferred<{ status: number; body?: unknown }>()
    mockFetch({ erasure: [d.promise] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    const busy = await within(dialog).findByRole('button', { name: m.excluindo })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: m.fechar })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: m.dialogoTitulo })).toBeInTheDocument()

    d.resolve({ status: 500 })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
    expect(within(dialog).getByRole('button', { name: m.fechar })).toBeInTheDocument()
  })

  it('en-US: a seção segue o idioma', async () => {
    const user = userEvent.setup()
    mockFetch({})
    renderSection('en-US')
    expect(screen.getByRole('region', { name: enUS.seusDados.titulo })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.seusDados.baixar })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: enUS.seusDados.excluir }))
    expect(await screen.findByRole('dialog', { name: enUS.seusDados.dialogoTitulo })).toBeInTheDocument()
  })

  it('en-US: a saída volta para a home em inglês', async () => {
    const user = userEvent.setup()
    mockFetch({})
    renderSection('en-US')
    await user.click(screen.getByRole('button', { name: enUS.seusDados.excluir }))
    const dialog = await screen.findByRole('dialog', { name: enUS.seusDados.dialogoTitulo })
    await user.click(within(dialog).getByRole('checkbox', { name: enUS.seusDados.entendo }))
    await user.click(within(dialog).getByRole('button', { name: enUS.seusDados.confirmar }))
    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/en-US'))
  })
})
