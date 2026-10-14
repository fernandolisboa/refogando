import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'

/**
 * Gaveta "Criar" sob demanda (achado G da auditoria de performance, handoff 70). O header monta o
 * `LazyCreateDrawer`, que baixa `create-drawer` por `import()`: pré-carga no ocioso e no
 * hover/foco/pointerdown do "Criar" (e ao abrir o menu mobile); o clique abre na hora com o código
 * já carregado, ou assim que ele chega; e, se o `import()` falha (aba antiga pós-deploy), o clique
 * navega para `/{locale}/create` sem o `AppUpdateGuard` recarregar a página.
 *
 * O store do carregamento é de MÓDULO (um por documento), então cada teste começa com
 * `vi.resetModules()` e importa header/provider/guard de novo. O `import('./create-drawer')` do
 * wrapper passa pelo `vi.doMock`: assim cada teste controla QUANDO o chunk chega (`gate`), se ele
 * falha e quantas vezes foi pedido (`loads`). `requestIdleCallback` é dublado para o ocioso só
 * disparar quando o teste mandar.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }),
  signOut: vi.fn(),
}))

const DRAWER = '@/components/recipe/create-drawer'

/** O erro que o runtime do Turbopack joga quando o `<script>` do chunk não carrega. */
function chunkError() {
  return Object.assign(
    new Error('Failed to load chunk /_next/static/chunks/0abc.js from module 211050'),
    { name: 'ChunkLoadError' },
  )
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((r) => {
    release = r
  })
  return { promise, release }
}

let loads = 0
let ready = 0
// Um import de um teste anterior pode resolver já dentro do seguinte (o 1º `importOriginal` da
// gaveta real transforma o módulo); a época impede que ele conte aqui.
let epoch = 0
let idleCallbacks: Array<() => void> = []
let assign: ReturnType<typeof vi.fn>
let reload: ReturnType<typeof vi.fn>
const originalLocation = window.location

beforeEach(() => {
  vi.resetModules()
  loads = 0
  ready = 0
  epoch++
  idleCallbacks = []
  window.sessionStorage.clear()
  const w = window as unknown as Record<string, unknown>
  w.requestIdleCallback = vi.fn((cb: () => void) => {
    idleCallbacks.push(cb)
    return idleCallbacks.length
  })
  w.cancelIdleCallback = vi.fn()
  assign = vi.fn()
  reload = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign, reload },
  })
})

afterEach(() => {
  // Desmonta antes de tirar os dublês (o cleanup do efeito do ocioso chama `cancelIdleCallback`).
  cleanup()
  vi.doUnmock(DRAWER)
  const w = window as unknown as Record<string, unknown>
  delete w.requestIdleCallback
  delete w.cancelIdleCallback
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  vi.restoreAllMocks()
})

/**
 * O chunk da gaveta: o módulo real, liberado quando `gate` resolve (ou falhando, se `fail`).
 * `loads` conta os pedidos; `ready`, os módulos entregues.
 */
function mockDrawerChunk(opts: { gate?: Promise<void>; fail?: boolean } = {}) {
  const mine = epoch
  vi.doMock(DRAWER, async (importOriginal) => {
    if (mine === epoch) loads++
    await opts.gate
    if (opts.fail) throw chunkError()
    const mod = await importOriginal()
    if (mine === epoch) ready++
    return mod
  })
}

async function renderHeader(locale: Locale = 'pt-BR') {
  const { LocaleProvider } = await import('@/i18n/provider')
  const { SiteHeader } = await import('@/components/site-header')
  const { AppUpdateGuard } = await import('@/components/app-update-guard')
  return render(
    <LocaleProvider initialLocale={locale}>
      <AppUpdateGuard />
      <SiteHeader />
    </LocaleProvider>,
  )
}

const criarButton = () => screen.getByRole('button', { name: ptBR.nav.create })

describe('Gaveta "Criar" sob demanda (handoff 70)', () => {
  it('nada da gaveta é pedido na montagem: só no ocioso', async () => {
    mockDrawerChunk()
    await renderHeader()
    await act(async () => {})
    expect(loads).toBe(0)
    expect(idleCallbacks).toHaveLength(1)

    await act(async () => idleCallbacks[0]())
    await waitFor(() => expect(loads).toBe(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sem requestIdleCallback (Safari), a pré-carga do ocioso cai num setTimeout', async () => {
    const w = window as unknown as Record<string, unknown>
    delete w.requestIdleCallback
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      mockDrawerChunk()
      await renderHeader()
      expect(loads).toBe(0)
      await act(async () => {
        vi.advanceTimersByTime(1500)
      })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(loads).toBe(1))
  })

  it('hover, foco e pointerdown no "Criar" pré-carregam (um import só) sem abrir', async () => {
    mockDrawerChunk()
    await renderHeader()

    fireEvent.pointerEnter(criarButton())
    await waitFor(() => expect(loads).toBe(1))
    fireEvent.focus(criarButton())
    fireEvent.pointerDown(criarButton())
    await act(async () => {})
    expect(loads).toBe(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('o foco pelo teclado pré-carrega', async () => {
    mockDrawerChunk()
    await renderHeader()
    act(() => criarButton().focus())
    await waitFor(() => expect(loads).toBe(1))
  })

  it('abrir o menu mobile pré-carrega (o "Criar" do celular mora nele)', async () => {
    const user = userEvent.setup()
    mockDrawerChunk()
    await renderHeader()
    await user.click(screen.getByRole('button', { name: ptBR.nav.abrirMenu }))
    await waitFor(() => expect(loads).toBe(1))
  })

  it('com o chunk já carregado, o clique abre a gaveta na hora; foco e Escape como antes', async () => {
    const user = userEvent.setup()
    mockDrawerChunk()
    await renderHeader()
    await act(async () => idleCallbacks[0]())
    await waitFor(() => expect(ready).toBe(1))
    await act(async () => {})

    // Referência guardada: com a gaveta aberta, o Radix esconde o resto da página (aria-hidden).
    const criar = criarButton()
    await user.click(criar)
    // Síncrono: sem esperar nada depois do clique. O foco vai para o 1º card do método-picker.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName(ptBR.criarDrawer.tituloPicker)
    expect(document.activeElement).toHaveTextContent(ptBR.criarDrawer.metodoEstruturadoTitulo)
    expect(criar).not.toHaveAttribute('aria-busy')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Igual ao de antes: sem `DialogTrigger`, o Radix não devolve o foco ao "Criar" (fica no body).
    await waitFor(() => expect(document.activeElement).toBe(document.body))
  })

  it('clique ANTES da pré-carga terminar: o botão fica aria-busy e a gaveta abre quando o chunk chega', async () => {
    const user = userEvent.setup()
    const gate = deferred()
    mockDrawerChunk({ gate: gate.promise })
    await renderHeader()

    const criar = criarButton()
    await user.click(criar)
    expect(loads).toBe(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(criar).toHaveAttribute('aria-busy', 'true')

    await act(async () => gate.release())
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(ptBR.criarDrawer.tituloPicker)
    await waitFor(() =>
      expect(document.activeElement).toHaveTextContent(ptBR.criarDrawer.metodoEstruturadoTitulo),
    )
    expect(criar).not.toHaveAttribute('aria-busy')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Igual ao de antes: sem `DialogTrigger`, o Radix não devolve o foco ao "Criar" (fica no body).
    await waitFor(() => expect(document.activeElement).toBe(document.body))
    expect(assign).not.toHaveBeenCalled()
  })

  it('import que falha depois do clique navega para /pt-BR/create, e o AppUpdateGuard não recarrega', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    const gate = deferred()
    mockDrawerChunk({ gate: gate.promise, fail: true })
    await renderHeader()

    await user.click(criarButton())
    expect(criarButton()).toHaveAttribute('aria-busy', 'true')

    // A falha real tem duas faces: o `error` do <script> do chunk (Event de recurso, sem
    // `error`/`message`, visto pelo listener de captura do guard) e a rejeição do `import()`.
    const script = document.createElement('script')
    document.body.appendChild(script)
    script.dispatchEvent(new Event('error'))
    script.remove()
    await act(async () => gate.release())

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/pt-BR/create'))
    expect(assign).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    expect(window.sessionStorage.getItem('app-update-reload')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(criarButton()).not.toHaveAttribute('aria-busy')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[criar]'), expect.anything())
  })

  it('pré-carga que já falhou: cada clique vai direto para a /create do locale (en-US)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const user = userEvent.setup()
    mockDrawerChunk({ fail: true })
    await renderHeader('en-US')
    await act(async () => idleCallbacks[0]())
    await waitFor(() => expect(loads).toBe(1))
    await act(async () => {})

    const criar = screen.getByRole('button', { name: enUS.nav.create })
    await user.click(criar)
    expect(assign).toHaveBeenCalledWith('/en-US/create')
    await user.click(criar)
    expect(assign).toHaveBeenCalledTimes(2)
    // Sem novo import (o runtime guarda a promessa rejeitada do chunk) e sem reload.
    expect(loads).toBe(1)
    expect(reload).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
