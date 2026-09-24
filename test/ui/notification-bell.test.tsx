import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Sininho de Notificações (#371, ADR-0028) — SÓ-logado (Modelo B: null no anon/pendente), badge de
 * não-lidas, painel com a lista localizada, e marca-tudo ao abrir. `useSession` e `fetch` mockados.
 * #460: itens viram LINKS (perfil/receita); `next/link` mockado p/ <a> simples (sem AppRouter no jsdom).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionData = { user: { id: string } } | null
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

import { LocaleProvider } from '@/i18n/provider'
import { NotificationBell } from '@/components/notification-bell'
import { ptBR } from '@/i18n/messages/pt-BR'

const authed = () => fakeSession({ data: { user: { id: 'u1' } } })

type MockPage = { notifications: unknown[]; unreadCount: number; nextCursor: string | null }

/** Mocka o fetch: GET /api/notifications → `page`; POST /read → { unreadCount: 0 }. */
function mockFetch(page: MockPage) {
  const readSpy = vi.fn()
  const impl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/api/notifications/read')) {
      readSpy(method)
      return { ok: true, status: 200, json: async () => ({ unreadCount: 0 }) } as Response
    }
    return { ok: true, status: 200, json: async () => page } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, readSpy }
}

function renderBell() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <NotificationBell />
    </LocaleProvider>,
  )
}

const M = ptBR.notifications

beforeEach(() => {
  mockSession = fakeSession()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('NotificationBell (#371)', () => {
  it('anônimo → não renderiza nada (Modelo B)', () => {
    mockSession = fakeSession()
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    const { container } = renderBell()
    expect(container).toBeEmptyDOMElement()
  })

  it('pendente → não renderiza nada', () => {
    mockSession = fakeSession({ isPending: true })
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    const { container } = renderBell()
    expect(container).toBeEmptyDOMElement()
  })

  it('logado → sininho com aria-label + badge de não-lidas', async () => {
    mockSession = authed()
    mockFetch({
      notifications: [
        { id: 'n1', type: 'new_follower', refs: { actorName: 'Ana' }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    const bell = screen.getByRole('button', { name: /Notificações/ })
    expect(bell).toBeInTheDocument()
    // badge aparece após o pull de mount
    expect(await screen.findByText('1')).toBeInTheDocument()
    // #461: com 1 não-lida, o RÓTULO do sino anuncia a contagem (singular); o badge é aria-hidden.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: M.ariaLabelUmaNaoLida })).toBeInTheDocument(),
    )
  })

  // #461 (a11y): a contagem de não-lidas entra no aria-label do sino (o badge visual é aria-hidden).
  it('aria-label do sino reflete a contagem: 0 → base; 1 → singular; >1 → plural com {n}', async () => {
    // 0 não-lidas: rótulo base, sem contagem.
    mockSession = authed()
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    const { unmount } = renderBell()
    expect(screen.getByRole('button', { name: M.ariaLabel })).toBeInTheDocument()
    unmount()

    // >1: plural com o número REAL interpolado.
    mockSession = authed()
    mockFetch({
      notifications: [
        { id: 'n1', type: 'new_follower', refs: { actorName: 'Ana' }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 3,
      nextCursor: null,
    })
    renderBell()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: M.ariaLabelNaoLidas.replace('{n}', '3') }),
      ).toBeInTheDocument(),
    )
    // O badge (visual) é aria-hidden ⇒ não vira nome acessível: o "3" do rótulo vem do template.
    expect(screen.getByText('3')).toHaveAttribute('aria-hidden', 'true')
  })

  it('abrir o painel: marca-tudo (POST read), zera o badge e mostra a lista localizada', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    const { readSpy } = mockFetch({
      notifications: [
        { id: 'n1', type: 'new_follower', refs: { actorName: 'Ana' }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    const bell = screen.getByRole('button', { name: /Notificações/ })
    await screen.findByText('1') // badge presente antes de abrir

    await user.click(bell)
    // O texto localizado do evento aparece no painel portaleado.
    expect(await screen.findByText('Ana começou a seguir você')).toBeInTheDocument()
    // Marca-tudo disparou (POST sem body) e o badge sumiu.
    await waitFor(() => expect(readSpy).toHaveBeenCalledWith('POST'))
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
  })

  it('sem notificações: painel mostra o estado vazio', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    mockFetch({ notifications: [], unreadCount: 0, nextCursor: null })
    renderBell()
    const bell = screen.getByRole('button', { name: /Notificações/ })
    await user.click(bell)
    expect(await screen.findByText(M.vazio)).toBeInTheDocument()
  })

  // #460: itens clicáveis (fecha o beco-sem-saída) via DropdownMenuItem asChild <Link> ⇒ role=menuitem
  // (foco/setas/Enter do Radix, alcançável por teclado). new_follower → /u/<handle>; review_on_recipe →
  // detalhe canônico /{locale}/recipes/<uuid>; tipo informativo/degradado → texto puro (sem menuitem).
  it('new_follower com handle: item é um MENUITEM navegável pro perfil /u/<handle>', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    mockFetch({
      notifications: [
        { id: 'n1', type: 'new_follower', refs: { actorName: 'Ana', actorHandle: 'ana' }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    await user.click(screen.getByRole('button', { name: /Notificações/ }))
    const item = await screen.findByRole('menuitem', { name: /Ana começou a seguir você/ })
    expect(item).toHaveAttribute('href', '/u/ana')
  })

  it('review_on_recipe com recipeId: MENUITEM pro detalhe canônico no locale', async () => {
    const user = userEvent.setup()
    const rid = '11111111-1111-4111-8111-111111111111'
    mockSession = authed()
    mockFetch({
      notifications: [
        { id: 'n2', type: 'review_on_recipe', refs: { actorName: 'Ana', actorHandle: 'ana', recipeId: rid, rating: 4 }, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    await user.click(screen.getByRole('button', { name: /Notificações/ }))
    const item = await screen.findByRole('menuitem', { name: /avaliou sua receita/ })
    expect(item).toHaveAttribute('href', `/pt-BR/recipes/${rid}`)
  })

  it('tipo informativo (account_restricted): texto puro, SEM menuitem/link', async () => {
    const user = userEvent.setup()
    mockSession = authed()
    mockFetch({
      notifications: [
        { id: 'n3', type: 'account_restricted', refs: {}, actorImage: null, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      unreadCount: 1,
      nextCursor: null,
    })
    renderBell()
    await user.click(screen.getByRole('button', { name: /Notificações/ }))
    expect(await screen.findByText(M.contaRestringida)).toBeInTheDocument()
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
