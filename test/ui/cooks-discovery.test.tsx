import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/pt-BR/cooks' }))

const authMock = vi.hoisted(() => {
  const anon = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }
  return { anon, current: anon as unknown }
})
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.current,
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { CozinhaVocabProvider } from '@/components/i18n/cozinha-vocab-provider'
import { CooksDiscovery } from '@/components/recipe/cooks-discovery'
import { ptBR } from '@/i18n/messages/pt-BR'

// jsdom não tem IntersectionObserver (scroll infinito) — stub inerte.
beforeAll(() => {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error stub de teste
  global.IntersectionObserver = IO
})

const seedCook = (handle: string) => ({
  name: `Cook ${handle}`,
  handle,
  image: null,
  recipeCount: 2,
  recipes: [],
})

function renderDiscovery() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <CozinhaVocabProvider value={[{ value: 'italiana', label: 'Italiana' }]}>
        <CooksDiscovery
          initialCooks={[seedCook('seed-a'), seedCook('seed-b')]}
          initialNextCursor={null}
          locale="pt-BR"
        />
      </CozinhaVocabProvider>
    </LocaleProvider>,
  )
}

beforeEach(() => {
  authMock.current = authMock.anon
  vi.restoreAllMocks()
})
afterEach(() => vi.restoreAllMocks())

describe('CooksDiscovery (#308)', () => {
  it('anon: mostra o SEED (sem fetch no mount), h1, busca e faceta de cozinha', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    renderDiscovery()
    expect(screen.getByRole('heading', { level: 1, name: ptBR.descobrirCozinheiros.titulo })).toBeInTheDocument()
    expect(screen.getByText('Cook seed-a')).toBeInTheDocument()
    expect(screen.getByText('Cook seed-b')).toBeInTheDocument()
    // faceta de cozinha (multi)
    expect(screen.getByText(ptBR.descobrirCozinheiros.cozinhaLabel)).toBeInTheDocument()
    // estado-seed (recs/global/anon) ⇒ NÃO busca no mount
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('digitar ≥3 chars dispara a busca e troca os resultados', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ cooks: [{ name: 'Achado', handle: 'achado', image: null }], nextCursor: null }), {
        status: 200,
      }),
    )
    const user = userEvent.setup()
    renderDiscovery()
    await user.type(screen.getByLabelText(ptBR.descobrirCozinheiros.buscarLabel), 'alfredo')
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled(), { timeout: 1500 })
    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain('/api/search/cooks')
    expect(url).toContain('q=alfredo')
    await waitFor(() => expect(screen.getByText('Achado')).toBeInTheDocument())
    expect(screen.queryByText('Cook seed-a')).not.toBeInTheDocument() // seed trocado pelos resultados
  })

  it('busca sem resultado mostra o empty state de busca', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ cooks: [], nextCursor: null }), { status: 200 }),
    )
    const user = userEvent.setup()
    renderDiscovery()
    await user.type(screen.getByLabelText(ptBR.descobrirCozinheiros.buscarLabel), 'zzzz')
    await waitFor(() => expect(screen.getByText(ptBR.descobrirCozinheiros.vazioBusca)).toBeInTheDocument(), {
      timeout: 1500,
    })
  })

  it('anon: "Seguir" do cartão é um LINK pro sign-in com returnTo (bounce, não toggle)', () => {
    renderDiscovery()
    const card = screen.getByText('Cook seed-a').closest('div')!.parentElement!.parentElement!
    const seguir = within(card).getByRole('link', { name: ptBR.cozinheirosSugeridos.seguir })
    expect(seguir).toHaveAttribute('href', expect.stringContaining('/sign-in?returnTo='))
    expect(seguir.getAttribute('href')).toContain(encodeURIComponent('/pt-BR/cooks'))
  })
})
