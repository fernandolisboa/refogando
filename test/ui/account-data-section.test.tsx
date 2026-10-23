import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * "Seus dados" no /me/profile (#595; LGPD Art. 18, II e V; eliminação: arts. 15, III e 16 (18, VI para as
 * restrições salvas)), pelo lado da UI: o titular baixa o export (`GET /api/me/export` por fetch + blob, nome
 * datado) e exclui a conta pelo diálogo (`POST /api/me/erasure`), sem usar a API na mão. `useSession` é um
 * store de verdade (dá para a sessão virar `null` no meio), `signOut`, `forgetTabs` e o sinal do aviso
 * (`account-notice-signal`) mockados; `fetch` por URL e método; `URL.createObjectURL` atribuído (o jsdom não
 * tem); o clique na âncora do download é espionado. O `SessionLossGuard` da raiz é montado junto: a saída
 * segura a recarga dele (`holdSessionLossReload`), senão ver a sessão sumir recarregaria a página atual por
 * cima do `location.assign` da home.
 */

const router = vi.hoisted(() => ({ refresh: () => {} }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean; isRefetching: boolean; refetch: () => void }
const sessionStore = vi.hoisted(() => {
  let state: unknown = null
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: unknown) {
      state = next
      for (const l of listeners) l()
    },
    subscribe(l: () => void) {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
})
const order = vi.hoisted(() => [] as string[])
const signOut = vi.hoisted(() => vi.fn(async () => {}))
const forgetTabs = vi.hoisted(() => vi.fn())
const markAccountNotice = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-client', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: () => useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get),
    signOut: () => {
      order.push('signOut')
      return signOut()
    },
  }
})
vi.mock('@/components/nav/last-tab-store', () => ({
  forgetTabs: () => {
    order.push('forgetTabs')
    forgetTabs()
  },
}))
vi.mock('@/components/profile/account-notice-signal', () => ({
  markAccountNotice: (kind: string) => {
    order.push(`mark:${kind}`)
    markAccountNotice(kind)
  },
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { accountExportFilename } from '@/domain/account-export'
import { tourStorageKey } from '@/domain/onboarding-tour'
import { avisoLegalStorageKey } from '@/domain/legal-notice'
import { AccountDataSection } from '@/components/profile/account-data-section'
import { SessionLossGuard, resetSessionLossGuardForTests } from '@/components/session-loss-guard'
import { stubLocation } from './reload-stub'

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

/** `hang`: nunca responde, mas respeita o `signal` (rejeita no abort, como o fetch de verdade). */
type Reply = { status: number; body?: unknown } | 'throw' | 'hang' | Promise<{ status: number; body?: unknown }>
type Call = { url: string; method: string; init: RequestInit | undefined; body: unknown }
type Route = 'export' | 'erasure' | 'session'

const ROUTES: Record<string, Route> = {
  '/api/me/export': 'export',
  '/api/me/erasure': 'erasure',
  '/api/auth/get-session': 'session',
}
/** O get-session de quem ainda está logado (a eliminação não aconteceu). */
const LIVE_SESSION = { status: 200, body: { session: { id: 's-1' }, user: { id: 'u-1' } } }
/** O get-session depois da eliminação: as sessões foram apagadas. */
const NO_SESSION = { status: 200, body: null }

/** fetch por rota: cada rota responde com a próxima resposta da fila (a última se repete). */
function mockFetch(routes: Partial<Record<Route, Reply[]>>) {
  const calls: Call[] = []
  const queues: Record<Route, Reply[]> = {
    export: [...(routes.export ?? [{ status: 200, body: { format: 'x' } }])],
    erasure: [...(routes.erasure ?? [{ status: 200, body: { ok: true } }])],
    session: [...(routes.session ?? [LIVE_SESSION])],
  }
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method, init, body })
    const key = ROUTES[url]
    if (!key) throw new Error(`rota inesperada: ${method} ${url}`)
    const q = queues[key]
    const next = q.length > 1 ? q.shift()! : q[0]
    if (next === 'throw') throw new TypeError('Failed to fetch')
    if (next === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      })
    }
    const r = await next
    const payload = 'body' in r ? r.body : {}
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => payload,
      blob: async () => new Blob([JSON.stringify(payload)], { type: 'application/json' }),
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  const urls = () => calls.map((c) => `${c.method} ${c.url}`)
  return { impl, calls, urls }
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
      <SessionLossGuard />
      <AccountDataSection />
    </LocaleProvider>,
  )
}

let clicks: Array<{ download: string; href: string }>
let loc: ReturnType<typeof stubLocation>
const createObjectURL = vi.fn((blob: Blob) => `blob:mock/${blob.size}`)
const revokeObjectURL = vi.fn()
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeEach(() => {
  resetSessionLossGuardForTests()
  sessionStore.set(authed())
  order.length = 0
  signOut.mockReset()
  // Como o de verdade: o `signOut` zera o atom da sessão (é o que o SessionLossGuard observa).
  signOut.mockImplementation(async () => {
    act(() => sessionStore.set(guest()))
  })
  forgetTabs.mockReset()
  markAccountNotice.mockReset()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
  clicks = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ download: this.download, href: this.href })
  })
  loc = stubLocation()
  loc.assign.mockImplementation(() => order.push('assign'))
  loc.reload.mockImplementation(() => order.push('reload'))
  window.localStorage.clear()
})
afterEach(() => {
  loc.restore()
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: m.excluir }))
  return screen.findByRole('dialog', { name: m.dialogoTitulo })
}

async function confirmErasure(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.click(within(dialog).getByRole('checkbox', { name: m.entendo }))
  await user.click(within(dialog).getByRole('button', { name: m.confirmar }))
}

/** O que importa da saída: o sinal do aviso antes do `signOut`, e a navegação por último. */
function expectExit(kind: 'excluida' | 'sessao', last: 'assign' | 'reload') {
  expect(markAccountNotice).toHaveBeenCalledOnce()
  expect(markAccountNotice).toHaveBeenCalledWith(kind)
  expect(order.indexOf(`mark:${kind}`)).toBeLessThan(order.indexOf('signOut'))
  expect(order.at(-1)).toBe(last)
  // Uma navegação só: a do diálogo. O SessionLossGuard ficou segurado (`holdSessionLossReload`).
  expect(order.filter((o) => o === 'assign' || o === 'reload')).toEqual([last])
}

describe('AccountDataSection — "Seus dados" (#595)', () => {
  it('Visitante: não renderiza nada', () => {
    sessionStore.set(guest())
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

  it('baixar: GET /api/me/export, salva o arquivo com o nome datado e anuncia o download iniciado', async () => {
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
    const { calls } = mockFetch({ export: [{ status: 500, body: { error: 'x' } }, 'throw'] })
    renderSection()
    await user.click(screen.getByRole('button', { name: m.baixar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(m.erroBaixar)
    await user.click(screen.getByRole('button', { name: m.baixar }))
    await waitFor(() => expect(calls).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: m.baixar })).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent(m.erroBaixar)
    expect(clicks).toHaveLength(0)
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('baixar: 401 diz que a sessão expirou (tentar de novo não adianta)', async () => {
    const user = userEvent.setup()
    mockFetch({ export: [{ status: 401, body: { error: 'nao_autenticado' } }] })
    renderSection()
    await user.click(screen.getByRole('button', { name: m.baixar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(m.erroBaixarSessao)
    expect(clicks).toHaveLength(0)
  })

  it('o diálogo explica o que é apagado, o que fica, aponta Minhas receitas e oferece baixar antes', async () => {
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
    // Quem quer apagar uma receita publicada vai a "Minhas receitas" (o rótulo do header) antes.
    const link = within(dialog).getByRole('link', { name: ptBR.nav.minhasReceitas })
    expect(link).toHaveAttribute('href', '/me/recipes')
    expect(link.parentElement).toHaveTextContent(m.apagarPublicadas.replace('{link}', ptBR.nav.minhasReceitas))
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

  it('baixar dentro do diálogo: o aviso aparece ali, e some ao fechar e reabrir', async () => {
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

  it('um download só: começado na seção, o diálogo mostra "Preparando…" e segura "Excluir definitivamente" até acabar', async () => {
    const user = userEvent.setup()
    const d = deferred<{ status: number; body?: unknown }>()
    const { calls } = mockFetch({ export: [d.promise] })
    renderSection()
    await user.click(screen.getByRole('button', { name: m.baixar }))
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: m.entendo }))

    expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: m.baixando })).toBeDisabled()

    d.resolve({ status: 200, body: {} })
    expect(await within(dialog).findByText(m.baixado)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeEnabled()
    expect(calls).toHaveLength(1)
  })

  it('confirmar: POST com {confirm:true} em JSON → sinal do aviso, abas, tour e "Entendi" dos Termos esquecidos, sai e recarrega a home do idioma', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(tourStorageKey('u-1'), 'done')
    window.localStorage.setItem(tourStorageKey('u-outra'), 'done')
    window.localStorage.setItem(avisoLegalStorageKey('u-1'), '1')
    window.localStorage.setItem(avisoLegalStorageKey('u-outra'), '1')
    const { calls } = mockFetch({})
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/pt-BR'))
    expect(calls).toEqual([
      expect.objectContaining({
        url: '/api/me/erasure',
        method: 'POST',
        init: expect.objectContaining({ headers: { 'content-type': 'application/json' } }),
        body: { confirm: true },
      }),
    ])
    expectExit('excluida', 'assign')
    expect(forgetTabs).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(tourStorageKey('u-1'))).toBeNull()
    expect(window.localStorage.getItem(tourStorageKey('u-outra'))).toBe('done')
    expect(window.localStorage.getItem(avisoLegalStorageKey('u-1'))).toBeNull()
    expect(window.localStorage.getItem(avisoLegalStorageKey('u-outra'))).toBe('1')
    expect(loc.reload).not.toHaveBeenCalled()
  })

  it('signOut que não responde (offline): sai mesmo assim depois de 3s', async () => {
    const user = userEvent.setup()
    signOut.mockImplementation(() => new Promise<void>(() => {}))
    mockFetch({})
    renderSection()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('checkbox', { name: m.entendo }))
    const confirmar = within(dialog).getByRole('button', { name: m.confirmar })

    vi.useFakeTimers()
    try {
      fireEvent.click(confirmar)
      await vi.advanceTimersByTimeAsync(0)
      expect(signOut).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(2_999)
      expect(loc.assign).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(loc.assign).toHaveBeenCalledWith('/pt-BR')
    } finally {
      vi.useRealTimers()
    }
  })

  describe('desfecho ambíguo: confere a sessão no get-session', () => {
    it('o fetch lança e a sessão já não existe → a conta foi excluída, saída normal', async () => {
      const user = userEvent.setup()
      const { calls, urls } = mockFetch({ erasure: ['throw'], session: [NO_SESSION] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)

      await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/pt-BR'))
      expect(urls()).toEqual(['POST /api/me/erasure', 'GET /api/auth/get-session'])
      expect(calls[1].init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
      expectExit('excluida', 'assign')
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    })

    it('o fetch lança e a sessão segue viva → erroExcluir, nada de sair', async () => {
      const user = userEvent.setup()
      const { urls } = mockFetch({ erasure: ['throw'], session: [LIVE_SESSION] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
      expect(urls()).toEqual(['POST /api/me/erasure', 'GET /api/auth/get-session'])
      expect(order).toEqual([])
      expect(markAccountNotice).not.toHaveBeenCalled()
    })

    it('504 e a sessão já não existe → saída normal (o commit pode ter vindo antes do timeout)', async () => {
      const user = userEvent.setup()
      mockFetch({ erasure: [{ status: 504 }], session: [NO_SESSION] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)

      await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/pt-BR'))
      expectExit('excluida', 'assign')
    })

    it('500 e a sessão segue viva → erroExcluir, o diálogo fica aberto, o botão volta e recebe o foco', async () => {
      const user = userEvent.setup()
      const d = deferred<{ status: number; body?: unknown }>()
      const { urls } = mockFetch({ erasure: [d.promise], session: [LIVE_SESSION] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)
      await within(dialog).findByRole('button', { name: m.excluindo })
      // O navegador tira o foco de um botão que fica desabilitado; o jsdom não (nem deixa dar `blur` nele).
      // Tira o foco do botão à mão, para o efeito ter o que devolver.
      act(() => dialog.focus())
      expect(dialog).toHaveFocus()

      d.resolve({ status: 500, body: { error: 'x' } })
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
      const confirmar = within(dialog).getByRole('button', { name: m.confirmar })
      expect(confirmar).toBeEnabled()
      await waitFor(() => expect(confirmar).toHaveFocus())
      expect(urls()).toEqual(['POST /api/me/erasure', 'GET /api/auth/get-session'])
      expect(screen.getByRole('dialog', { name: m.dialogoTitulo })).toBeInTheDocument()
      expect(signOut).not.toHaveBeenCalled()
      expect(loc.assign).not.toHaveBeenCalled()
      expect(loc.reload).not.toHaveBeenCalled()
    })

    it('get-session que não responde: desiste em 8s e mostra erroExcluir (não fica em "Excluindo…")', async () => {
      const user = userEvent.setup()
      // O `AbortSignal.timeout` nativo não segue os timers falsos: troca por um que segue, com o mesmo efeito.
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
        const c = new AbortController()
        window.setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms)
        return c.signal
      })
      const { urls } = mockFetch({ erasure: ['throw'], session: ['hang'] })
      renderSection()
      const dialog = await openDialog(user)
      await user.click(within(dialog).getByRole('checkbox', { name: m.entendo }))
      const confirmar = within(dialog).getByRole('button', { name: m.confirmar })

      vi.useFakeTimers()
      try {
        fireEvent.click(confirmar)
        await vi.advanceTimersByTimeAsync(0)
        expect(urls()).toEqual(['POST /api/me/erasure', 'GET /api/auth/get-session'])
        expect(timeout).toHaveBeenCalledWith(8_000)
        await vi.advanceTimersByTimeAsync(7_999)
        expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
        await vi.advanceTimersByTimeAsync(1)
      } finally {
        vi.useRealTimers()
      }
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
      expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeEnabled()
      expect(loc.assign).not.toHaveBeenCalled()
      expect(markAccountNotice).not.toHaveBeenCalled()
    })

    it('get-session também falha → erroExcluir (sem saber, não sai)', async () => {
      const user = userEvent.setup()
      mockFetch({ erasure: ['throw'], session: ['throw'] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
      expect(loc.assign).not.toHaveBeenCalled()
    })
  })

  it('401 (sessão morta): mostra erroSessao, deixa o aviso para depois da recarga e recarrega, sem conferir a sessão', async () => {
    const user = userEvent.setup()
    const { urls } = mockFetch({ erasure: [{ status: 401, body: { error: 'nao_autenticado' } }] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroSessao)
    await waitFor(() => expect(loc.reload).toHaveBeenCalledOnce())
    expectExit('sessao', 'reload')
    expect(forgetTabs).toHaveBeenCalledOnce()
    expect(urls()).toEqual(['POST /api/me/erasure'])
    expect(loc.assign).not.toHaveBeenCalled()
  })

  it('outro 4xx (403 da guarda de origem): erroExcluir, sem conferir a sessão', async () => {
    const user = userEvent.setup()
    const { urls } = mockFetch({ erasure: [{ status: 403, body: { error: 'origem_nao_permitida' } }] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
    expect(urls()).toEqual(['POST /api/me/erasure'])
    expect(order).toEqual([])
  })

  describe('sessão antiga (#602)', () => {
    const REAUTH_HREF = `/sign-in?returnTo=${encodeURIComponent('/me/profile#seus-dados')}`
    function withSessionCreatedAt(createdAt: Date): SessionState {
      const s = authed()
      return { ...s, data: { ...(s.data as object), session: { id: 's-1', createdAt } } }
    }

    it('403 reautenticar: pede para entrar de novo (link volta a Seus dados), trava o botão e não sai', async () => {
      const user = userEvent.setup()
      const { urls } = mockFetch({ erasure: [{ status: 403, body: { error: 'reautenticar' } }] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)

      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent(m.reautenticar)
      expect(within(alert).getByRole('link', { name: m.reautenticarLink })).toHaveAttribute('href', REAUTH_HREF)
      expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeDisabled()
      // O botão ficou travado: o foco vai ao aviso (não cai no body).
      await waitFor(() => expect(alert).toHaveFocus())
      expect(urls()).toEqual(['POST /api/me/erasure'])
      expect(order).toEqual([])

      // Fechar e reabrir limpa o aviso e destrava o botão.
      await user.click(within(dialog).getByRole('button', { name: m.cancelar }))
      const again = await openDialog(user)
      expect(within(again).queryByText(m.reautenticar, { exact: false })).toBeNull()
      await user.click(within(again).getByRole('checkbox', { name: m.entendo }))
      expect(within(again).getByRole('button', { name: m.confirmar })).toBeEnabled()
    })

    it('403 com outro código (guarda de origem) segue sendo erroExcluir', async () => {
      const user = userEvent.setup()
      mockFetch({ erasure: [{ status: 403, body: { error: 'origem_nao_permitida' } }] })
      renderSection()
      const dialog = await openDialog(user)
      await confirmErasure(user, dialog)
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
      expect(within(dialog).queryByText(m.reautenticar, { exact: false })).toBeNull()
    })

    it('sessão antiga pelo relógio do aparelho: o diálogo já abre com o aviso, mas quem trava é o servidor', async () => {
      sessionStore.set(withSessionCreatedAt(new Date(Date.now() - 25 * 60 * 60 * 1000)))
      const user = userEvent.setup()
      const { urls } = mockFetch({ erasure: [{ status: 403, body: { error: 'reautenticar' } }] })
      renderSection()
      const dialog = await openDialog(user)

      const aviso = within(dialog).getByRole('status')
      expect(aviso).toHaveTextContent(m.reautenticar)
      expect(within(aviso).getByRole('link', { name: m.reautenticarLink })).toHaveAttribute('href', REAUTH_HREF)
      // Um relógio adiantado não pode travar a exclusão: o botão segue livre até o servidor dizer 403.
      await confirmErasure(user, dialog)
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.reautenticar)
      expect(within(dialog).getByRole('button', { name: m.confirmar })).toBeDisabled()
      expect(urls()).toEqual(['POST /api/me/erasure'])
    })

    it('sessão recente: sem aviso, a exclusão segue normal', async () => {
      sessionStore.set(withSessionCreatedAt(new Date(Date.now() - 60 * 60 * 1000)))
      const user = userEvent.setup()
      mockFetch({})
      renderSection()
      const dialog = await openDialog(user)
      expect(within(dialog).queryByRole('alert')).toBeNull()
      await confirmErasure(user, dialog)
      await waitFor(() => expect(loc.assign).toHaveBeenCalledOnce())
    })
  })

  it('enquanto exclui: Esc não fecha, o X some, o link de Minhas receitas vira texto e o botão fica aria-busy', async () => {
    const user = userEvent.setup()
    const d = deferred<{ status: number; body?: unknown }>()
    mockFetch({ erasure: [d.promise], session: [LIVE_SESSION] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)

    const busy = await within(dialog).findByRole('button', { name: m.excluindo })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: m.fechar })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: m.dialogoTitulo })).toBeInTheDocument()
    // "Minhas receitas" vira texto: seguir o link desmontaria a página no meio da exclusão.
    expect(within(dialog).queryByRole('link', { name: ptBR.nav.minhasReceitas })).not.toBeInTheDocument()
    expect(within(dialog).getByText(ptBR.nav.minhasReceitas)).toBeInTheDocument()

    d.resolve({ status: 500 })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(m.erroExcluir)
    expect(within(dialog).getByRole('button', { name: m.fechar })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: ptBR.nav.minhasReceitas })).toHaveAttribute('href', '/me/recipes')
  })

  it('a sessão vira null no meio do pedido (refetch ao voltar online): o diálogo fica e termina a saída', async () => {
    const user = userEvent.setup()
    const d = deferred<{ status: number; body?: unknown }>()
    mockFetch({ erasure: [d.promise] })
    renderSection()
    const dialog = await openDialog(user)
    await confirmErasure(user, dialog)
    await within(dialog).findByRole('button', { name: m.excluindo })

    act(() => sessionStore.set(guest()))
    expect(screen.getByRole('dialog', { name: m.dialogoTitulo })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: m.titulo })).toBeInTheDocument()

    d.resolve({ status: 200, body: { ok: true } })
    await waitFor(() => expect(loc.assign).toHaveBeenCalledWith('/pt-BR'))
    expectExit('excluida', 'assign')
    expect(screen.getByRole('dialog', { name: m.dialogoTitulo })).toBeInTheDocument()
  })

  it('en-US: a seção segue o idioma', async () => {
    const user = userEvent.setup()
    mockFetch({})
    renderSection('en-US')
    expect(screen.getByRole('region', { name: enUS.seusDados.titulo })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.seusDados.baixar })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: enUS.seusDados.excluir }))
    const dialog = await screen.findByRole('dialog', { name: enUS.seusDados.dialogoTitulo })
    expect(within(dialog).getByRole('link', { name: enUS.nav.minhasReceitas })).toHaveAttribute('href', '/me/recipes')
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
