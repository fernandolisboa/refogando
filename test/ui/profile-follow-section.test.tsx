import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Ilha SEGUIR (#274) — seam jsdom (#54). O perfil é anon-cacheável (sem seed SSR), então a ilha BUSCA
 * o estado "eu sigo? / sou eu?" client-side (`GET`) só quando logada, e aplica otimismo no toggle com
 * revert no erro. Mockamos `useSession` (por teste) e `fetch` (GET estado + POST/DELETE).
 */
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

let mockSession: unknown = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }
vi.mock('@/lib/auth-client', () => ({ useSession: () => mockSession }))

import { ptBR } from '@/i18n/messages/pt-BR'
import { ProfileFollowSection } from '@/components/profile/profile-follow-section'

const MP = ptBR.perfilPublico

const anon = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }
const pending = { data: null, error: null, isPending: true, isRefetching: false, refetch: () => {} }
const authed = {
  data: { user: { id: 'u1', name: 'Ana', email: 'a@x.com' } },
  error: null,
  isPending: false,
  isRefetching: false,
  refetch: () => {},
}

type Reply = { ok: boolean; status?: number; body: unknown }
function mockFetch(handler: (method: string) => Reply) {
  const impl = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const r = handler((init?.method ?? 'GET').toUpperCase())
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderSection(initialFollowerCount = 10, followingCount = 7) {
  return render(
    <ProfileFollowSection
      handle="chef-ana"
      initialFollowerCount={initialFollowerCount}
      followingCount={followingCount}
      labels={MP}
    />,
  )
}

beforeEach(() => {
  mockSession = anon
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfileFollowSection (#274)', () => {
  it('anônimo: mostra a contagem + "Entrar para seguir" (link), SEM tocar a API', () => {
    mockSession = anon
    const fetchMock = mockFetch(() => ({ ok: true, body: {} }))
    renderSection(10)
    expect(screen.getByText(MP.seguidoresContagem.replace('{n}', '10'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: MP.entrarParaSeguir })).toHaveAttribute('href', '/sign-in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // BUG 1 (layout): os DOIS contadores ADJACENTES (seguidores → seguindo), o botão por ÚLTIMO —
  // NUNCA o botão ENTRE os contadores. Posicional/red-first: os três nós já existiam, mas em ordem
  // errada (seguidores / botão / seguindo), então só a ORDEM no textContent protege o fix.
  it('os dois contadores ficam ADJACENTES e o botão por último (botão nunca entre eles)', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    const { container } = renderSection(3, 5)
    const row = container.firstElementChild as HTMLElement
    // seguidores → seguindo → botão (o nudge anon "Entrar para seguir"), nesta ordem exata.
    expect(row.textContent).toMatch(
      new RegExp(
        `${MP.seguidoresContagem.replace('{n}', '3')}[\\s\\S]*${MP.seguindoContagem.replace('{n}', '5')}[\\s\\S]*${MP.entrarParaSeguir}`,
      ),
    )
    // aria-live é SÓ do contador de SEGUIDORES (o único que muda no clique). O "seguindo" é estático
    // SSR e NÃO deve ser anunciado — senão um aria-live errôneo nele passaria batido.
    const live = container.querySelectorAll('[aria-live]')
    expect(live).toHaveLength(1)
    expect(live[0]).toHaveTextContent(MP.seguidoresContagem.replace('{n}', '3'))
    // O "seguindo" estático aparece, mas SEM aria-live.
    const seguindo = screen.getByText(MP.seguindoContagem.replace('{n}', '5'))
    expect(seguindo).not.toHaveAttribute('aria-live')
  })

  it('erro de sessão (fail-open): trata como anônimo → nudge, sem tocar a API', () => {
    mockSession = { data: null, error: new Error('get-session falhou'), isPending: false, isRefetching: false, refetch: () => {} }
    const fetchMock = mockFetch(() => ({ ok: true, body: {} }))
    renderSection(10)
    expect(screen.getByRole('link', { name: MP.entrarParaSeguir })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('contagem singular: 1 → "1 seguidor" (não "1 seguidores")', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection(1)
    expect(screen.getByText(MP.seguidorContagem.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.queryByText(MP.seguidoresContagem.replace('{n}', '1'))).toBeNull()
  })

  it('pendente: só a contagem (sem botão nem nudge — evita flash do convite pro logado)', () => {
    mockSession = pending
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection(10)
    expect(screen.getByText(MP.seguidoresContagem.replace('{n}', '10'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: MP.entrarParaSeguir })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('logado não-seguindo: GET → "Seguir"; clicar → POST → "Seguindo" + contagem +1', async () => {
    mockSession = authed
    const user = userEvent.setup()
    mockFetch((method) =>
      method === 'GET'
        ? { ok: true, body: { isFollowing: false, isSelf: false } }
        : { ok: true, body: { isFollowing: true, followerCount: 11 } },
    )
    renderSection(10)
    const btn = await screen.findByRole('button', { name: MP.seguir })
    await user.click(btn)
    expect(await screen.findByRole('button', { name: MP.seguindo })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(MP.seguidoresContagem.replace('{n}', '11'))).toBeInTheDocument(),
    )
  })

  it('logado seguindo: GET → "Seguindo"; clicar → DELETE → "Seguir" + contagem -1', async () => {
    mockSession = authed
    const user = userEvent.setup()
    mockFetch((method) =>
      method === 'GET'
        ? { ok: true, body: { isFollowing: true, isSelf: false } }
        : { ok: true, body: { isFollowing: false, followerCount: 9 } },
    )
    renderSection(10)
    const btn = await screen.findByRole('button', { name: MP.seguindo })
    await user.click(btn)
    expect(await screen.findByRole('button', { name: MP.seguir })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText(MP.seguidoresContagem.replace('{n}', '9'))).toBeInTheDocument(),
    )
  })

  it('próprio perfil (isSelf): contagem, mas SEM botão', async () => {
    mockSession = authed
    mockFetch(() => ({ ok: true, body: { isFollowing: false, isSelf: true } }))
    renderSection(10)
    // espera o GET resolver, depois confirma que nenhum botão aparece
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('button', { name: MP.seguir })).toBeNull()
    expect(screen.queryByRole('button', { name: MP.seguindo })).toBeNull()
  })

  it('erro no POST: reverte estado e contagem, mostra erro neutro', async () => {
    mockSession = authed
    const user = userEvent.setup()
    mockFetch((method) =>
      method === 'GET' ? { ok: true, body: { isFollowing: false, isSelf: false } } : { ok: false, status: 500, body: {} },
    )
    renderSection(10)
    const btn = await screen.findByRole('button', { name: MP.seguir })
    await user.click(btn)
    // Revert: volta pra "Seguir", contagem volta a 10, erro neutro aparece.
    expect(await screen.findByRole('alert')).toHaveTextContent(MP.erroSeguir)
    expect(screen.getByRole('button', { name: MP.seguir })).toBeInTheDocument()
    expect(screen.getByText(MP.seguidoresContagem.replace('{n}', '10'))).toBeInTheDocument()
  })
})
