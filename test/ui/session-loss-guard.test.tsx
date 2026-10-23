import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { stubReload } from './reload-stub'

/**
 * SessionLossGuard (ADR-0028, Adendo 2026-10-23): ao perder a sessão (Sair aqui ou em outra aba, sessão
 * expirada) a página recarrega, para o Console e as telas pessoais não ficarem abertas com dado já
 * carregado; mudança de papel na mesma conta só faz `router.refresh()`.
 */
type SessionData = { user: { id: string; role?: string } } | null
const fakeSession = (over: Partial<{ data: SessionData; error: unknown; isPending: boolean }> = {}) => ({
  data: null as SessionData,
  error: null as unknown,
  isPending: false,
  isRefetching: false,
  refetch: vi.fn(),
  ...over,
})

let mockSession = fakeSession()
vi.mock('@/lib/auth-client', () => ({ useSession: () => mockSession }))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { SessionLossGuard, holdSessionLossReload, resetSessionLossGuardForTests } from '@/components/session-loss-guard'

const admin = (id = 'u1', role = 'admin'): SessionData => ({
  user: { id, role },
})

describe('SessionLossGuard', () => {
  let reload: ReturnType<typeof stubReload>['reload']
  let restore: () => void

  beforeEach(() => {
    const s = stubReload()
    reload = s.reload
    restore = s.restore
    refresh.mockReset()
    resetSessionLossGuardForTests()
  })
  afterEach(() => {
    restore()
  })

  it('não renderiza nada e não recarrega no mount (logado ou anônimo)', () => {
    mockSession = fakeSession({ data: admin() })
    const { container } = render(<SessionLossGuard />)
    expect(container).toBeEmptyDOMElement()
    mockSession = fakeSession()
    render(<SessionLossGuard />)
    expect(reload).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('logado → anônimo recarrega a página uma vez', () => {
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: null })
    rerender(<SessionLossGuard />)
    expect(reload).toHaveBeenCalledTimes(1)
    rerender(<SessionLossGuard />)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('401 do get-session (data zerado + erro) também é perda de sessão', () => {
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: null, error: { status: 401 } })
    rerender(<SessionLossGuard />)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('erro de rede não é perda de sessão', () => {
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({
      data: null,
      error: new TypeError('Failed to fetch'),
    })
    rerender(<SessionLossGuard />)
    expect(reload).not.toHaveBeenCalled()
    // A rede volta e a sessão segue a mesma: nada a fazer.
    mockSession = fakeSession({ data: admin() })
    rerender(<SessionLossGuard />)
    expect(reload).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('carregando (refetch sem dado) não conta como anônimo', () => {
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: null, isPending: true })
    rerender(<SessionLossGuard />)
    expect(reload).not.toHaveBeenCalled()
  })

  it('troca de conta recarrega', () => {
    mockSession = fakeSession({ data: admin('u1') })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: admin('u2') })
    rerender(<SessionLossGuard />)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('entrar (anônimo → logado) não recarrega', () => {
    mockSession = fakeSession()
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: admin() })
    rerender(<SessionLossGuard />)
    expect(reload).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('papel muda na mesma conta: router.refresh, sem recarga', () => {
    mockSession = fakeSession({ data: admin('u1', 'admin') })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: admin('u1', 'usuario') })
    rerender(<SessionLossGuard />)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('com hold ativo a perda não recarrega; soltar o último recarrega uma vez (quem segurou não navegou)', () => {
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    const a = holdSessionLossReload()
    const b = holdSessionLossReload()
    mockSession = fakeSession({ data: null })
    rerender(<SessionLossGuard />)
    expect(reload).not.toHaveBeenCalled()
    a()
    a()
    expect(reload).not.toHaveBeenCalled()
    b()
    expect(reload).toHaveBeenCalledTimes(1)
    b()
    rerender(<SessionLossGuard />)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('soltar sem perda no meio não recarrega', () => {
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    const release = holdSessionLossReload()
    rerender(<SessionLossGuard />)
    release()
    expect(reload).not.toHaveBeenCalled()
  })

  it('hold solto volta a recarregar na próxima perda', () => {
    const release = holdSessionLossReload()
    release()
    mockSession = fakeSession({ data: admin() })
    const { rerender } = render(<SessionLossGuard />)
    mockSession = fakeSession({ data: null })
    rerender(<SessionLossGuard />)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
