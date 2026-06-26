import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Ilha SEGUIR (#274 + perfil estilo Instagram) — seam jsdom (#54). A ilha renderiza a LINHA DE STATS
 * (receitas · seguidores · seguindo, com o número em negrito; só SEGUIDORES é dinâmico, com aria-live
 * no número) + o BOTÃO numa LINHA ABAIXO. Contadores são âncoras pra MESMA página (versão lite #307):
 * receitas → sempre #perfil-receitas; seguidores/seguindo SÓ quando > 0 (a seção-alvo só existe c/ ≥1).
 * O perfil é anon-cacheável (sem seed SSR): a ilha BUSCA "eu sigo?/sou eu?" client-side (`GET`) só quando
 * logada, e aplica otimismo no toggle com revert no erro. Mockamos `useSession` (por teste) e `fetch`.
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

function renderSection(opts: { followers?: number; recipes?: number; following?: number } = {}) {
  const { followers = 10, recipes = 5, following = 3 } = opts
  return render(
    <ProfileFollowSection
      handle="chef-ana"
      recipesCount={recipes}
      initialFollowerCount={followers}
      followingCount={following}
      labels={MP}
    />,
  )
}

/** Substitui '{n}' — o nome acessível completo (número + palavra) de um contador. */
function countLabel(template: string, n: number) {
  return template.replace('{n}', String(n))
}

/** Acha o elemento-folha do contador (span/<a>) cujo texto normalizado é a string completa. O número
 *  fica num <strong> aninhado, então o texto é quebrado em nós — casamos pelo textContent do elemento. */
function statText(full: string) {
  return screen.getByText((_content, el): boolean => {
    if (!el) return false
    const norm = el.textContent?.replace(/\s+/g, ' ').trim()
    const onlyStrongChildren = Array.from(el.children).every((c) => c.tagName === 'STRONG')
    return onlyStrongChildren && norm === full
  })
}

beforeEach(() => {
  mockSession = anon
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfileFollowSection — linha de stats estilo Instagram', () => {
  it('mostra os 3 contadores inline (receitas · seguidores · seguindo) com os números em negrito', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ recipes: 5, followers: 10, following: 3 })
    // Cada contador (todos > 0 ⇒ links) tem o nome acessível "N palavra".
    expect(screen.getByRole('link', { name: countLabel(MP.receitasContagem, 5) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 10) })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: countLabel(MP.seguindoContagem, 3) })).toBeInTheDocument()
    // O NÚMERO vai em <strong> (negrito).
    expect(screen.getByText('5').tagName).toBe('STRONG')
    expect(screen.getByText('10').tagName).toBe('STRONG')
    expect(screen.getByText('3').tagName).toBe('STRONG')
  })

  it('contadores > 0 são âncoras pra MESMA página: receitas/seguidores/seguindo', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ recipes: 5, followers: 10, following: 3 })
    expect(screen.getByRole('link', { name: countLabel(MP.receitasContagem, 5) })).toHaveAttribute(
      'href',
      '#perfil-receitas',
    )
    expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 10) })).toHaveAttribute(
      'href',
      '#perfil-seguidores',
    )
    expect(screen.getByRole('link', { name: countLabel(MP.seguindoContagem, 3) })).toHaveAttribute(
      'href',
      '#perfil-seguindo',
    )
  })

  it('contador 0 de seguidores/seguindo = texto puro (sem link); receitas SEMPRE linka', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ recipes: 0, followers: 0, following: 0 })
    // Seguidores/seguindo em 0: não há seção-alvo ⇒ texto puro, sem link.
    expect(screen.queryByRole('link', { name: countLabel(MP.seguidoresContagem, 0) })).toBeNull()
    expect(screen.queryByRole('link', { name: countLabel(MP.seguindoContagem, 0) })).toBeNull()
    expect(statText(countLabel(MP.seguidoresContagem, 0))).toBeInTheDocument()
    expect(statText(countLabel(MP.seguindoContagem, 0))).toBeInTheDocument()
    // Receitas linka mesmo em 0 (a seção #perfil-receitas sempre existe).
    expect(screen.getByRole('link', { name: countLabel(MP.receitasContagem, 0) })).toHaveAttribute(
      'href',
      '#perfil-receitas',
    )
  })

  it('o aria-live segue no NÚMERO de seguidores (não no de receitas/seguindo)', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ recipes: 5, followers: 10, following: 3 })
    expect(screen.getByText('10')).toHaveAttribute('aria-live', 'polite')
    // Os números estáticos NÃO têm região viva.
    expect(screen.getByText('5')).not.toHaveAttribute('aria-live')
    expect(screen.getByText('3')).not.toHaveAttribute('aria-live')
  })

  it('contador singular: 1 → "1 seguidor" (não "1 seguidores")', () => {
    mockSession = anon
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ followers: 1 })
    expect(screen.getByRole('link', { name: countLabel(MP.seguidorContagem, 1) })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: countLabel(MP.seguidoresContagem, 1) })).toBeNull()
  })
})

describe('ProfileFollowSection — botão na LINHA ABAIXO dos stats', () => {
  it('anônimo: "Entrar para seguir" (link /sign-in) FORA da linha de stats, SEM tocar a API', () => {
    mockSession = anon
    const fetchMock = mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ recipes: 5, followers: 10, following: 3 })
    const nudge = screen.getByRole('link', { name: MP.entrarParaSeguir })
    expect(nudge).toHaveAttribute('href', '/sign-in')
    // O nudge NÃO está dentro do <p> de stats (linha separada, abaixo).
    const statsP = screen.getByRole('link', { name: countLabel(MP.receitasContagem, 5) }).closest('p')
    expect(statsP).not.toBeNull()
    expect(within(statsP as HTMLElement).queryByRole('link', { name: MP.entrarParaSeguir })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logado não-seguindo: o botão "Seguir" fica FORA da linha de stats', async () => {
    mockSession = authed
    mockFetch((method) =>
      method === 'GET' ? { ok: true, body: { isFollowing: false, isSelf: false } } : { ok: true, body: {} },
    )
    renderSection({ recipes: 5, followers: 10, following: 3 })
    const btn = await screen.findByRole('button', { name: MP.seguir })
    const statsP = screen.getByRole('link', { name: countLabel(MP.receitasContagem, 5) }).closest('p')
    expect(within(statsP as HTMLElement).queryByRole('button')).toBeNull()
    expect(statsP).not.toContainElement(btn)
  })

  it('erro de sessão (fail-open): trata como anônimo → nudge, sem tocar a API', () => {
    mockSession = { data: null, error: new Error('get-session falhou'), isPending: false, isRefetching: false, refetch: () => {} }
    const fetchMock = mockFetch(() => ({ ok: true, body: {} }))
    renderSection()
    expect(screen.getByRole('link', { name: MP.entrarParaSeguir })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('pendente: só os stats (sem botão nem nudge — evita flash do convite pro logado)', () => {
    mockSession = pending
    mockFetch(() => ({ ok: true, body: {} }))
    renderSection({ recipes: 5, followers: 10, following: 3 })
    expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 10) })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: MP.entrarParaSeguir })).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('ProfileFollowSection — toggle dinâmico de seguidores', () => {
  it('logado não-seguindo: GET → "Seguir"; clicar → POST → "Seguindo" + contagem +1', async () => {
    mockSession = authed
    const user = userEvent.setup()
    mockFetch((method) =>
      method === 'GET'
        ? { ok: true, body: { isFollowing: false, isSelf: false } }
        : { ok: true, body: { isFollowing: true, followerCount: 11 } },
    )
    renderSection({ followers: 10 })
    const btn = await screen.findByRole('button', { name: MP.seguir })
    await user.click(btn)
    expect(await screen.findByRole('button', { name: MP.seguindo })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 11) })).toBeInTheDocument(),
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
    renderSection({ followers: 10 })
    const btn = await screen.findByRole('button', { name: MP.seguindo })
    await user.click(btn)
    expect(await screen.findByRole('button', { name: MP.seguir })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 9) })).toBeInTheDocument(),
    )
  })

  it('próprio perfil (isSelf): stats, mas SEM botão', async () => {
    mockSession = authed
    mockFetch(() => ({ ok: true, body: { isFollowing: false, isSelf: true } }))
    renderSection({ followers: 10 })
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByRole('button', { name: MP.seguir })).toBeNull()
    expect(screen.queryByRole('button', { name: MP.seguindo })).toBeNull()
    // Os stats seguem presentes.
    expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 10) })).toBeInTheDocument()
  })

  it('erro no POST: reverte estado e contagem, mostra erro neutro', async () => {
    mockSession = authed
    const user = userEvent.setup()
    mockFetch((method) =>
      method === 'GET' ? { ok: true, body: { isFollowing: false, isSelf: false } } : { ok: false, status: 500, body: {} },
    )
    renderSection({ followers: 10 })
    const btn = await screen.findByRole('button', { name: MP.seguir })
    await user.click(btn)
    expect(await screen.findByRole('alert')).toHaveTextContent(MP.erroSeguir)
    expect(screen.getByRole('button', { name: MP.seguir })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: countLabel(MP.seguidoresContagem, 10) })).toBeInTheDocument()
  })
})
