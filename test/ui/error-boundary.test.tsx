import { Component, type ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { LocaleProvider } from '@/i18n/provider'
import GlobalError from '@/app/[locale]/error'
import { ptBR } from '@/i18n/messages/pt-BR'
import { reportClientError, resetClientErrorReportState } from '@/lib/client-error-report'
import { createClientErrorIntake } from '@/server/http/client-error-intake'
import { stubReload } from './reload-stub'

// #590: o relato real, LIGADO (fora de produção ele é no-op) e com o transporte capturado — o corpo enviado
// passa depois pelo intake de verdade, provando "erro em componente ⇒ uma linha estruturada sem PII".
const { sent } = vi.hoisted(() => ({ sent: [] as string[] }))
vi.mock('@/lib/client-error-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/client-error-report')>()
  return {
    ...actual,
    reportClientError: vi.fn((...[tipo, err, opts]: Parameters<typeof actual.reportClientError>) =>
      actual.reportClientError(tipo, err, { ...opts, enabled: true, storage: null, send: (b) => sent.push(b) }),
    ),
  }
})

/**
 * Error boundary global (#54) + atualização graceful A2 (#372, ADR-0028 dec 5): um chunk de rota
 * velho pós-deploy é jogado em RENDER e cai AQUI (não no window) → reload quieto one-shot. Erro
 * comum mantém a tela calma de "tentar de novo".
 */
function renderErr(error: Error & { digest?: string }, reset = vi.fn()) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <GlobalError error={error} reset={reset} />
    </LocaleProvider>,
  )
  return reset
}

describe('GlobalError — atualização graceful A2 (#372)', () => {
  let reloadSpy: ReturnType<typeof stubReload>['reload']
  let restoreReload: () => void

  beforeEach(() => {
    window.sessionStorage.clear()
    vi.mocked(reportClientError).mockClear()
    const s = stubReload()
    reloadSpy = s.reload
    restoreReload = s.restore
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    restoreReload()
    vi.restoreAllMocks()
  })

  it('recarrega em ChunkLoadError de render-phase (sem chamar reset) e não relata (#590)', () => {
    const error = Object.assign(new Error('Loading chunk 9 failed'), { name: 'ChunkLoadError' })
    const reset = renderErr(error)
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    expect(reportClientError).not.toHaveBeenCalled()
  })

  it('erro comum mantém a tela de "tentar de novo" e o botão chama reset', async () => {
    const user = userEvent.setup()
    const reset = renderErr(new Error('boom'))
    expect(reloadSpy).not.toHaveBeenCalled()
    const btn = screen.getByRole('button', { name: ptBR.system.retry })
    await user.click(btn)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})

/** Boundary mínima no papel do Next: pega o erro de render do filho e mostra a `error.tsx` do app. */
class TestBoundary extends Component<{ children: ReactNode }, { error: (Error & { digest?: string }) | null }> {
  state = { error: null as (Error & { digest?: string }) | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    return this.state.error ? <GlobalError error={this.state.error} reset={() => {}} /> : this.props.children
  }
}

function Explode({ error }: { error: Error }): ReactNode {
  throw error
}

/** O corpo que o navegador mandaria, passado pelo intake de verdade; devolve as linhas do log. */
async function linesFromSent(): Promise<string[]> {
  const lines: string[] = []
  const intake = createClientErrorIntake({ log: (l) => lines.push(l) })
  for (const body of sent) {
    const res = await intake(new Request('http://localhost/api/client-errors', { method: 'POST', body }))
    expect(res.status).toBe(204)
  }
  return lines
}

describe('GlobalError — relato do erro de componente (#590, critério de saída)', () => {
  beforeEach(() => {
    sent.length = 0
    resetClientErrorReportState() // dedup e tetos são por carga de página: zera entre testes
    vi.mocked(reportClientError).mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {}) // o React loga o erro pego
    window.history.replaceState(null, '', '/pt-BR/u/maria?token=abc123')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('erro forçado em componente ⇒ boundary relata UMA vez ⇒ uma linha estruturada sem PII', async () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <TestBoundary>
          <Explode error={new TypeError(`falhou para maria@x.com (reading 'title')`)} />
        </TestBoundary>
      </LocaleProvider>,
    )
    expect(screen.getByRole('heading', { name: ptBR.system.error })).toBeInTheDocument()
    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(vi.mocked(reportClientError).mock.calls[0][0]).toBe('boundary')
    const lines = await linesFromSent()
    expect(lines).toEqual([
      `[erro] origem=cliente rota=/[locale]/u/[param] tipo=boundary erro=TypeError digest=- msg="falhou para <email> (reading 'title')"`,
    ])
    for (const bad of ['maria', 'token', 'abc123']) expect(lines[0]).not.toContain(bad)
  })

  it('erro de Server Component (com digest) ⇒ linha sem mensagem', async () => {
    const err = Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '2738485511' })
    renderErr(err)
    expect(await linesFromSent()).toEqual([
      '[erro] origem=cliente rota=/[locale]/u/[param] tipo=boundary erro=Error digest=2738485511',
    ])
  })
})
