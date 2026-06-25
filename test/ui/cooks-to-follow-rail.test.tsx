import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecommendedCook } from '@/domain/recommended-cooks-read'

/**
 * Trilho "Cozinheiros pra seguir" (#278) — ilha cliente. Mocka `useSession` + `next/link` + `fetch`.
 * Cobre Modelo B (null no SSR/anon/pendente — nada renderizado), o gate de limiar (esconde < MIN),
 * a renderização dos cartões e o clique Seguir (POST otimista).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({ useSession: () => sessionState }))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { CooksToFollowRail } from '@/components/recipe/cooks-to-follow-rail'

const M = ptBR.cozinheirosSugeridos

const authed: SessionState = { data: { user: { id: 'u-1' } }, error: null, isPending: false }
const anon: SessionState = { data: null, error: null, isPending: false }
const pending: SessionState = { data: null, error: null, isPending: true }

function cook(handle: string, name: string, recipeCount = 2): RecommendedCook {
  return { handle, name, image: null, recipeCount }
}

/** Mocka fetch: /api/discovery/cooks → { cooks }; /api/u/.../follow → estado de seguir. */
function mockFetch(cooks: RecommendedCook[]) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/api/discovery/cooks')) {
      return { ok: true, status: 200, json: async () => ({ cooks }) } as Response
    }
    // toggle de seguir
    return {
      ok: true,
      status: 200,
      json: async () => ({ isFollowing: (init?.method ?? 'POST') === 'POST', followerCount: 1 }),
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderRail(session: SessionState) {
  sessionState = session
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CooksToFollowRail />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CooksToFollowRail (#278)', () => {
  it('Visitante: renderiza NADA e NÃO busca (Modelo B — home anon byte-idêntica)', () => {
    const fetchMock = mockFetch([cook('a', 'A'), cook('b', 'B'), cook('c', 'C')])
    const { container } = renderRail(anon)
    expect(screen.queryByText(M.titulo)).toBeNull()
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sessão pendente: renderiza NADA e NÃO busca', () => {
    const fetchMock = mockFetch([cook('a', 'A'), cook('b', 'B'), cook('c', 'C')])
    const { container } = renderRail(pending)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logado, candidatos < MIN: trilho OCULTO (esconde abaixo do limiar)', async () => {
    const fetchMock = mockFetch([cook('a', 'A'), cook('b', 'B')]) // 2 < MIN(3)
    renderRail(authed)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(M.titulo)).toBeNull()
  })

  it('logado, candidatos >= MIN: mostra o trilho com cartões (nome, @handle, contagem)', async () => {
    mockFetch([cook('ana', 'Ana', 1), cook('beto', 'Beto', 2), cook('caio', 'Caio', 5)])
    renderRail(authed)
    expect(await screen.findByText(M.titulo)).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('@beto')).toBeInTheDocument()
    // singular vs plural da contagem
    expect(screen.getByText(M.receitaContagem.replace('{n}', '1'))).toBeInTheDocument()
    expect(screen.getByText(M.receitasContagem.replace('{n}', '5'))).toBeInTheDocument()
    // um botão Seguir por cartão
    expect(screen.getAllByRole('button', { name: M.seguir })).toHaveLength(3)
    // link pro perfil público
    expect(screen.getByRole('link', { name: /Ana/ })).toHaveAttribute('href', '/u/ana')
  })

  it('clicar Seguir: POST e flip para "Seguindo" (otimista, sem GET por item)', async () => {
    const fetchMock = mockFetch([cook('ana', 'Ana'), cook('beto', 'Beto'), cook('caio', 'Caio')])
    const user = userEvent.setup()
    renderRail(authed)
    const botoes = await screen.findAllByRole('button', { name: M.seguir })
    await user.click(botoes[0])
    expect(await screen.findByRole('button', { name: M.seguindo })).toBeInTheDocument()
    // nenhum GET de estado por item: só o GET do trilho + o POST do clique.
    const followCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/u/'))
    expect(followCalls).toHaveLength(1)
    expect((followCalls[0][1] as RequestInit | undefined)?.method).toBe('POST')
  })
})
