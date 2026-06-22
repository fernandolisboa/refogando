import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeListItem } from '@/domain/recipe-list-read'

/**
 * Teste jsdom de "Minhas criações" — lista (#61). `fetch` mockado no shape REAL de
 * `GET /api/me/recipes` ({ recipes }). `useSession`/`next/link` mockados (sem AppRouter/Better
 * Auth no jsdom). LocaleProvider real. Asserções: renderiza os próprios cards (incl. private/
 * playful badges), estado vazio com CTA, guest CTA, en-US, e SEM âmbar (selos neutros).
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
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { MyRecipesList } from '@/components/recipe/my-recipes-list'

const M = ptBR.minhasCriacoes

function authed(): SessionState {
  return { data: { user: { id: 'u-1' } }, error: null, isPending: false }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false }
}

function item(over: Partial<RecipeListItem> = {}): RecipeListItem {
  return {
    id: 'r-1',
    name: 'Bolo de fubá',
    origin: 'ai_structured',
    visibility: 'private',
    resultKind: 'success',
    lineageKind: null,
    updatedAt: '2026-06-18T00:00:00.000Z',
    moderationRemovida: false,
    ...over,
  }
}

function mockRecipes(recipes: RecipeListItem[]) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    if (!String(input).includes('/api/me/recipes')) throw new Error(`fetch não mockado: ${String(input)}`)
    return { ok: true, status: 200, json: async () => ({ recipes }) } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function mockError() {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    void input
    return { ok: false, status: 500, json: async () => ({}) } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderList(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <MyRecipesList />
    </LocaleProvider>,
  )
}

function semAmbar(container: HTMLElement) {
  expect(container.querySelector('[class*="aviso"]')).toBeNull()
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('MyRecipesList (#61)', () => {
  it('T1 — lista as próprias criações com selos NEUTROS (private/playful/derivada), sem âmbar', async () => {
    sessionState = authed()
    mockRecipes([
      item({ id: 'r-priv', name: 'Minha privada', visibility: 'private' }),
      item({ id: 'r-pub', name: 'Minha pública', visibility: 'public' }),
      item({ id: 'r-play', name: 'Brincadeira de cozinha', resultKind: 'playful' }),
      item({ id: 'r-der', name: 'Minha derivada', lineageKind: 'edited' }),
    ])
    const { container } = renderList()

    expect(await screen.findByText('Minha privada')).toBeInTheDocument()
    expect(screen.getByText('Minha pública')).toBeInTheDocument()
    expect(screen.getByText('Brincadeira de cozinha')).toBeInTheDocument()
    expect(screen.getByText('Minha derivada')).toBeInTheDocument()

    // Selos por estado.
    expect(screen.getAllByText(M.seloPrivada).length).toBeGreaterThan(0)
    expect(screen.getByText(M.seloPublica)).toBeInTheDocument()
    expect(screen.getByText(M.seloPlayful)).toBeInTheDocument()
    expect(screen.getByText(M.seloDerivada)).toBeInTheDocument()

    // Cada card linka pro detalhe.
    const links = screen.getAllByRole('link')
    expect(links.some((a) => a.getAttribute('href') === '/recipes/r-priv')).toBe(true)
    semAmbar(container)
  })

  it('T2 — estado vazio: mensagem + CTA criar primeira receita', async () => {
    sessionState = authed()
    mockRecipes([])
    renderList()
    expect(await screen.findByText(M.vazio)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: M.criarPrimeira })
    expect(cta).toHaveAttribute('href', '/create')
  })

  it('T3 — Visitante: convite de entrar (sem fetch)', async () => {
    sessionState = guest()
    const fetchMock = mockRecipes([])
    renderList()
    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute('href', '/sign-in')
    // Guest NÃO chama o endpoint.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('T4 — erro 500: alerta neutro', async () => {
    sessionState = authed()
    mockError()
    const { container } = renderList()
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.erro)
    semAmbar(container)
  })

  it('T6 — selo "fora do acervo" numa receita removida-do-pool (moderationRemovida)', async () => {
    sessionState = authed()
    mockRecipes([
      item({ id: 'r-rem', name: 'Minha removida', visibility: 'public', moderationRemovida: true }),
      item({ id: 'r-ok', name: 'Minha no acervo', visibility: 'public', moderationRemovida: false }),
    ])
    renderList()
    expect(await screen.findByText('Minha removida')).toBeInTheDocument()
    // O selo aparece exatamente uma vez (só na receita removida).
    const selos = screen.getAllByText(M.seloRemovida)
    expect(selos).toHaveLength(1)
  })

  it('T7 — #169/ADR-0019: selo "importada da web" na receita web_imported (e só nela)', async () => {
    sessionState = authed()
    mockRecipes([
      item({ id: 'r-imp', name: 'Feijoada importada', origin: 'web_imported', visibility: 'private' }),
      item({ id: 'r-gen', name: 'Receita gerada', origin: 'ai_structured', visibility: 'private' }),
    ])
    renderList()
    expect(await screen.findByText('Feijoada importada')).toBeInTheDocument()
    // O selo aparece exatamente uma vez (só na importada).
    const selos = screen.getAllByText(M.seloImportada)
    expect(selos).toHaveLength(1)
  })

  it('T5 — en-US: título de selo traduzido', async () => {
    sessionState = authed()
    mockRecipes([item({ name: 'My recipe', visibility: 'public' })])
    renderList('en-US')
    await waitFor(() => expect(screen.getByText('My recipe')).toBeInTheDocument())
    expect(screen.getByText(enUS.minhasCriacoes.seloPublica)).toBeInTheDocument()
  })
})
