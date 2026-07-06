import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom do botão "Adicionar à lista de compras" (fatia B, issue #527,
 * ADR-0032 dec.3/7) — espelha `recipe-engagement-controls.test.tsx`. Cobre: anônimo (convite,
 * sem fetch), logado (abre popover, lista as Listas, adiciona), porções-alvo lida do
 * `PortionScaleProvider` corrente (SEM campo numérico próprio — dec.3), aviso `sem_porcoes`
 * quando a Receita não declara `porcoes`, criar lista inline.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/recipes/bolo-de-cenoura',
}))

const authMock = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))

function setSession(state: 'logged-in' | 'anon' | 'pending') {
  authMock.session =
    state === 'logged-in'
      ? { data: { user: { id: 'u1' } }, isPending: false, error: null }
      : state === 'anon'
        ? { data: null, isPending: false, error: null }
        : { data: null, isPending: true, error: null }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { PortionScaleProvider } from '@/components/recipe/recipe-portion-scale-context'
import { RecipeShoppingListButton } from '@/components/recipe/recipe-shopping-list-button'

const M = ptBR.listaDeCompras

type FetchResult = { status: number; body: unknown }

function mockFetch(byUrl: (url: string, init: RequestInit | undefined) => FetchResult) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const init = args[1] as RequestInit | undefined
    const r = byUrl(url, init)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

type Props = {
  locale?: Locale
  originalPorcoes: number
  porcoesReceita: number | null
}

function renderButton(opts: Props) {
  const { locale = 'pt-BR', originalPorcoes, porcoesReceita } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <PortionScaleProvider originalPorcoes={originalPorcoes}>
        <RecipeShoppingListButton recipeId="r-1" porcoesReceita={porcoesReceita} />
      </PortionScaleProvider>
    </LocaleProvider>,
  )
}

beforeEach(() => {
  setSession('logged-in')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeShoppingListButton (#527)', () => {
  it('ANÔNIMO: link /sign-in, sem popover, sem fetch', async () => {
    const user = userEvent.setup()
    setSession('anon')
    const fetchMock = mockFetch(() => ({ status: 200, body: {} }))
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })

    const link = screen.getByRole('link', { name: M.convidaEntrarAdicionar })
    expect(link).toHaveAttribute('href', '/sign-in?returnTo=%2Frecipes%2Fbolo-de-cenoura')
    await user.click(link)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('LOGADO: clicar no ícone abre o popover e lista as Listas do usuário', async () => {
    const user = userEvent.setup()
    mockFetch((url) =>
      url.endsWith('/api/me/shopping-lists')
        ? { status: 200, body: { lists: [{ id: 'l1', name: 'Compras', createdAt: '', updatedAt: '', itemCount: 0 }] } }
        : { status: 200, body: {} },
    )
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })

    await user.click(screen.getByRole('button', { name: M.adicionar }))

    expect(await screen.findByText('Compras')).toBeInTheDocument()
    expect(screen.getByText(M.adicionarALista)).toBeInTheDocument()
  })

  it('adicionar a uma Lista: POST com recipeId + porcoesAlvo (Receita COM porcoes)', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((url) =>
      url.endsWith('/api/me/shopping-lists')
        ? { status: 200, body: { lists: [{ id: 'l1', name: 'Compras' }] } }
        : { status: 200, body: { ok: true } },
    )
    // originalPorcoes=4 e porcoesReceita=4 (o usuário não mexeu no escalador — porções-alvo = 4).
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })

    await user.click(screen.getByRole('button', { name: M.adicionar }))
    await screen.findByText('Compras')
    await user.click(screen.getByRole('button', { name: M.adicionarBotao }))

    const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/me/shopping-lists/l1/items')
    expect(call).toBeDefined()
    const init = call?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ recipeId: 'r-1', porcoesAlvo: 4 })
    expect(await screen.findByText(M.adicionado)).toBeInTheDocument()
  })

  it('Receita SEM porcoes (porcoesReceita null): NÃO manda porcoesAlvo', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((url) =>
      url.endsWith('/api/me/shopping-lists')
        ? { status: 200, body: { lists: [{ id: 'l1', name: 'Compras' }] } }
        : { status: 200, body: { ok: true } },
    )
    renderButton({ originalPorcoes: 1, porcoesReceita: null })

    await user.click(screen.getByRole('button', { name: M.adicionar }))
    await screen.findByText('Compras')
    await user.click(screen.getByRole('button', { name: M.adicionarBotao }))

    const call = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/me/shopping-lists/l1/items')
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ recipeId: 'r-1' })
  })

  it('warning sem_porcoes na resposta: mostra o aviso na linha da Lista', async () => {
    const user = userEvent.setup()
    mockFetch((url) =>
      url.endsWith('/api/me/shopping-lists')
        ? { status: 200, body: { lists: [{ id: 'l1', name: 'Compras' }] } }
        : { status: 200, body: { ok: true, warning: 'sem_porcoes' } },
    )
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })

    await user.click(screen.getByRole('button', { name: M.adicionar }))
    await screen.findByText('Compras')
    await user.click(screen.getByRole('button', { name: M.adicionarBotao }))

    expect(await screen.findByText(M.avisoSemPorcoes)).toBeInTheDocument()
  })

  it('sem Listas ainda: mensagem de vazio + form de criar', async () => {
    const user = userEvent.setup()
    mockFetch((url) =>
      url.endsWith('/api/me/shopping-lists') ? { status: 200, body: { lists: [] } } : { status: 200, body: {} },
    )
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })

    await user.click(screen.getByRole('button', { name: M.adicionar }))
    expect(await screen.findByText(M.semListas)).toBeInTheDocument()
  })

  it('criar lista nova inline: POST /api/me/shopping-lists e já adiciona a Receita', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch((url, init) => {
      if (url === '/api/me/shopping-lists' && (init?.method ?? 'GET') === 'GET') {
        return { status: 200, body: { lists: [] } }
      }
      if (url === '/api/me/shopping-lists' && init?.method === 'POST') {
        return { status: 200, body: { list: { id: 'novo', name: 'Churrasco' } } }
      }
      return { status: 200, body: { ok: true } }
    })
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })

    await user.click(screen.getByRole('button', { name: M.adicionar }))
    await screen.findByText(M.semListas)

    await user.type(screen.getByPlaceholderText(M.novaLista), 'Churrasco')
    await user.click(screen.getByRole('button', { name: M.criarEAdicionar }))

    expect(
      fetchMock.mock.calls.some(
        (c) => String(c[0]) === '/api/me/shopping-lists' && (c[1] as RequestInit)?.method === 'POST',
      ),
    ).toBe(true)
    expect(
      fetchMock.mock.calls.some((c) => String(c[0]) === '/api/me/shopping-lists/novo/items'),
    ).toBe(true)
    expect(await screen.findByText('Churrasco')).toBeInTheDocument()
  })

  it('en-US: rótulos traduzidos', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { lists: [] } }))
    renderButton({ locale: 'en-US', originalPorcoes: 4, porcoesReceita: 4 })

    await user.click(screen.getByRole('button', { name: enUS.listaDeCompras.adicionar }))
    expect(await screen.findByText(enUS.listaDeCompras.semListas)).toBeInTheDocument()
  })
})
