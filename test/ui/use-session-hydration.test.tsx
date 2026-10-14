import { act, useSyncExternalStore } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * `useSession` de `@/lib/auth-client` (handoff 71): durante a hidratação devolve o estado do servidor
 * (pendente), mesmo que o get-session já tenha respondido no navegador; depois, o valor real. O hook do
 * Better Auth é dublado com a MESMA forma do original (`useSyncExternalStore(subscribe, get, get)`, o
 * snapshot de servidor é o valor atual), que é o que causava o erro de hidratação #418.
 */
type SessionState = {
  data: { user: { name: string } } | null
  error: null
  isPending: boolean
  isRefetching: boolean
  refetch: () => void
}

const PENDING: SessionState = {
  data: null,
  error: null,
  isPending: true,
  isRefetching: false,
  refetch: () => {},
}

const store = vi.hoisted(() => {
  let value: unknown
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next: unknown) => {
      value = next
      listeners.forEach((l) => l())
    },
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
})

vi.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    useSession: () => useSyncExternalStore(store.subscribe, store.get, store.get),
  }),
}))
vi.mock('better-auth/client/plugins', () => ({ adminClient: () => ({}) }))

const { useSession } = await import('@/lib/auth-client')

function Probe({ onRender }: { onRender?: (s: SessionState) => void }) {
  const s = useSession() as unknown as SessionState
  onRender?.(s)
  if (s.isPending) return <span>carregando</span>
  return <span>{s.data ? `logado ${s.data.user.name}` : 'anônimo'}</span>
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useSession: hidratação casa com o servidor', () => {
  it('get-session já respondeu antes de hidratar: 1º render pendente, depois o valor real, sem erro', async () => {
    store.set(PENDING)
    const html = renderToString(<Probe />)
    expect(html).toContain('carregando')

    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)

    // O get-session responde ANTES de a árvore hidratar (o caso que dava #418).
    store.set({ ...PENDING, data: { user: { name: 'Ana' } }, isPending: false })

    const seen: boolean[] = []
    const recoverable = vi.fn()
    await act(async () => {
      hydrateRoot(container, <Probe onRender={(s) => seen.push(s.isPending)} />, {
        onRecoverableError: recoverable,
      })
    })

    expect(recoverable).not.toHaveBeenCalled()
    expect(seen[0]).toBe(true)
    expect(container.textContent).toBe('logado Ana')
  })

  it('montado depois da hidratação (navegação no client): o valor real no 1º render', async () => {
    store.set({ ...PENDING, data: null, isPending: false })
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.appendChild(container)
    const seen: boolean[] = []
    await act(async () => {
      createRoot(container).render(<Probe onRender={(s) => seen.push(s.isPending)} />)
    })
    expect(seen[0]).toBe(false)
    expect(container.textContent).toBe('anônimo')
  })
})
