import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { stubReload } from './reload-stub'

/**
 * Login/cadastro × SessionLossGuard (ADR-0028, Adendo 2026-10-23). Entrar como OUTRA conta estando logado
 * troca a sessão; o guard não pode recarregar a tela de login por cima do `router.push(dest)`. O AuthForm
 * segura a recarga do envio até sair da tela; ao soltar, a troca vista no meio recarrega o destino.
 * `useSession` é um store de verdade: o `signIn.email` mockado troca a conta como o de verdade.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router }))
vi.mock('next/link', () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

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
const signInEmail = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-client', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: () => useSyncExternalStore(sessionStore.subscribe, sessionStore.get, sessionStore.get),
    signIn: { email: (...a: unknown[]) => signInEmail(...a), social: vi.fn() },
    signUp: { email: vi.fn() },
  }
})

import { LocaleProvider } from '@/i18n/provider'
import { AuthForm } from '@/components/auth/auth-form'
import { SessionLossGuard, resetSessionLossGuardForTests } from '@/components/session-loss-guard'

type Handlers = { onSuccess?: (ctx: { data: unknown }) => void; onError?: (ctx: { error: { code?: string } }) => void }
const session = (id: string | null) => ({
  data: id ? { user: { id, role: 'usuario' } } : null,
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: () => {},
})

function renderLogin() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SessionLossGuard />
      <AuthForm mode="sign-in" googleEnabled={false} />
    </LocaleProvider>,
  )
}

async function submit() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), 'b@ex.com')
  await user.type(screen.getByLabelText('Senha'), 'segredo123')
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('AuthForm segura o SessionLossGuard na troca de conta', () => {
  let reload: ReturnType<typeof stubReload>['reload']
  let restore: () => void

  beforeEach(() => {
    resetSessionLossGuardForTests()
    router.push.mockClear()
    router.refresh.mockClear()
    signInEmail.mockReset()
    const s = stubReload()
    reload = s.reload
    restore = s.restore
  })
  afterEach(() => restore())

  it('logado como A entra como B: não recarrega o login; ao sair da tela, recarrega o destino uma vez', async () => {
    sessionStore.set(session('a'))
    signInEmail.mockImplementation(async (_b: unknown, h?: Handlers) => {
      act(() => sessionStore.set(session('b')))
      h?.onSuccess?.({ data: {} })
      return { data: {}, error: null }
    })
    const { unmount } = renderLogin()
    await submit()
    expect(router.push).toHaveBeenCalledWith('/')
    expect(reload).not.toHaveBeenCalled()
    unmount()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('visitante entra: nenhuma recarga, nem ao sair da tela', async () => {
    sessionStore.set(session(null))
    signInEmail.mockImplementation(async (_b: unknown, h?: Handlers) => {
      act(() => sessionStore.set(session('b')))
      h?.onSuccess?.({ data: {} })
      return { data: {}, error: null }
    })
    const { unmount } = renderLogin()
    await submit()
    unmount()
    expect(reload).not.toHaveBeenCalled()
  })

  it('login falha: solta o hold na hora; uma saída depois volta a recarregar', async () => {
    sessionStore.set(session('a'))
    signInEmail.mockImplementation(async (_b: unknown, h?: Handlers) => {
      h?.onError?.({ error: { code: 'INVALID_EMAIL_OR_PASSWORD' } })
      return { data: null, error: { code: 'INVALID_EMAIL_OR_PASSWORD' } }
    })
    renderLogin()
    await submit()
    expect(router.push).not.toHaveBeenCalled()
    act(() => sessionStore.set(session(null)))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
