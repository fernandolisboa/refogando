import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { SearchResponse } from '@/domain/recipe-search-read'

/**
 * Teste de COMPONENTE jsdom da DESCOBERTA na web (#164, ADR-0019) na Busca. Cobre o GATING no cliente:
 *  - acervo local RASO (abaixo do limiar) ⇒ dispara /api/discovery/web e renderiza a seção "Da web"
 *    com LINKS externos (target=_blank, rel external), marcados "da web · <fonte>";
 *  - acervo local SUFICIENTE ⇒ NÃO chama /api/discovery/web (nem mostra a seção);
 *  - os links da web vivem numa seção SEPARADA, fora do ranking interno (não viram RecipeResultItem).
 *
 * Espelha os mocks canônicos (next/link → <a>; useSession → estado mutável). O `fetch` é roteado por
 * URL: /api/search devolve o acervo local; /api/discovery/web devolve os links da web.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// #169: a Busca usa useRouter().push para levar o usuário à receita importada após o 201.
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

type SessionState = {
  data: unknown
  error: unknown
  isPending: boolean
  isRefetching: boolean
  refetch: () => void
}
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

function anon(): SessionState {
  return { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
}

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { SearchExperience } from '@/components/recipe/search-experience'

const M = ptBR.busca

type WebLink = { title: string; url: string; sourceName: string }

function renderSearch() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <SearchExperience />
    </LocaleProvider>,
  )
}

const WEB_LINKS: WebLink[] = [
  { title: 'Feijoada Completa', url: 'https://tudogostoso.com.br/feijoada', sourceName: 'TudoGostoso' },
  { title: 'Feijoada à Brasileira', url: 'https://panelinha.com.br/feijoada', sourceName: 'Panelinha' },
]

/**
 * Mocka `fetch` roteando por URL: /api/search → `search`; /api/discovery/web → `web`. Devolve o spy
 * para asserções de "foi/não foi chamado".
 */
function stubFetchRouting(
  search: SearchResponse,
  web: WebLink[],
  importResult: { status: number; body?: unknown } = { status: 201, body: { recipeId: 'imp-1', visibility: 'private' } },
) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('/api/discovery/web')) {
      return { ok: true, json: async () => ({ results: web }) }
    }
    // #169: POST /api/recipes/import — devolve o status configurado (201 sucesso / 422 não importável).
    if (url.includes('/api/recipes/import')) {
      return {
        ok: importResult.status >= 200 && importResult.status < 300,
        status: importResult.status,
        json: async () => importResult.body ?? {},
      }
    }
    return { ok: true, json: async () => search }
  }) as unknown as typeof fetch
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock as unknown as ReturnType<typeof vi.fn>
}

const emptyLocal: SearchResponse = { minhas: [], catalogo: [], comunidade: [] }

function localWith(n: number): SearchResponse {
  const comunidade = Array.from({ length: n }, (_, i) => ({
    recipeId: `r${i}`,
    displayedTitle: `Receita ${i}`,
    origin: 'ai_chat' as const,
    autoTranslationSignal: false,
    isOwn: false,
  }))
  return { minhas: [], catalogo: [], comunidade }
}

function discoveryCalls(fetchMock: ReturnType<typeof vi.fn>): unknown[][] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/discovery/web'))
}

beforeEach(() => {
  sessionState = anon()
  push.mockClear()
})

/** Helper para casar o nome acessível do gatilho do resultado da web (título + atribuição). */
function webTrigger(title: string) {
  return screen.findByRole('button', { name: new RegExp(title) })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('SearchExperience — descoberta na web (#164)', () => {
  it('W1 — acervo RASO (vazio): mostra a seção "Da web" com cartões marcados (gatilhos de import)', async () => {
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    // A seção "Da web" aparece (heading nível 2 separado).
    const heading = await screen.findByRole('heading', { name: M.secaoDaWeb, level: 2 })
    expect(heading).toBeInTheDocument()

    // #169: cada resultado da web é agora um GATILHO (button) que abre o modal de import — NÃO um
    // link externo cru. O nome acessível combina título + atribuição ("da web · <fonte>").
    const trigger = await webTrigger(WEB_LINKS[0].title)
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    // Atribuição "da web · <fonte>" no cartão.
    expect(
      screen.getByText(M.daWebFonte.replace('{fonte}', WEB_LINKS[0].sourceName)),
    ).toBeInTheDocument()

    // A descoberta na web FOI chamada (com o termo).
    expect(discoveryCalls(fetchMock).length).toBeGreaterThan(0)
    expect(String(discoveryCalls(fetchMock)[0][0])).toContain('q=feijoada')
  })

  it('W2 — acervo SUFICIENTE: NÃO chama /api/discovery/web nem mostra a seção', async () => {
    const fetchMock = stubFetchRouting(localWith(3), WEB_LINKS) // 3 = no limiar, NÃO é raso
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    // Os resultados locais aparecem (Comunidade).
    await screen.findByRole('heading', { name: M.secaoComunidade, level: 2 })

    // Damos tempo a qualquer efeito assíncrono — e a web NÃO é tocada.
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/search')),
      ).toBe(true)
    })
    expect(discoveryCalls(fetchMock).length).toBe(0)
    expect(screen.queryByRole('heading', { name: M.secaoDaWeb })).not.toBeInTheDocument()
  })

  it('W3 — acervo raso mas web VAZIA: não renderiza a seção "Da web"', async () => {
    stubFetchRouting(emptyLocal, []) // raso, mas a web devolveu nada (desligada/sem allowlist)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'inexistente')

    // O vazio local aparece; a seção da web NÃO (sem links).
    await screen.findByText(M.semResultado)
    expect(screen.queryByRole('heading', { name: M.secaoDaWeb })).not.toBeInTheDocument()
  })

  it('W4 — resultados da web NÃO entram no ranking interno (seção própria, gatilho, não RecipeResultItem)', async () => {
    stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')

    const trigger = await webTrigger(WEB_LINKS[0].title)
    // O gatilho vive sob a seção "Da web", NÃO sob Catálogo/Comunidade/Minhas.
    const section = trigger.closest('section')!
    const sectionHeading = section.querySelector('h2')
    expect(sectionHeading?.textContent).toBe(M.secaoDaWeb)
    // E é um BOTÃO (abre modal), nunca uma rota interna /recipes/<id>.
    expect(trigger.tagName).toBe('BUTTON')
    expect(trigger).not.toHaveAttribute('href')
  })
})

// ── #169 (ADR-0019): modal de importação ligado ao backend de import ────────────
describe('SearchExperience — modal de importação (#169)', () => {
  it('I1 — LOGADO: clicar num resultado da web abre o modal de confirmação (com "Ver no site")', async () => {
    sessionState = authed()
    stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    const trigger = await webTrigger(WEB_LINKS[0].title)
    await user.click(trigger)

    // Modal aberto: role=dialog com o título de importação.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(M.importarTitulo)).toBeInTheDocument()
    // Caminho "Ver no site": link externo pro site de origem (exibir ≠ importar).
    const verNoSite = screen.getByRole('link', { name: M.importarVerNoSite })
    expect(verNoSite).toHaveAttribute('href', WEB_LINKS[0].url)
    expect(verNoSite).toHaveAttribute('target', '_blank')
    expect(verNoSite.getAttribute('rel')).toContain('external')
  })

  it('I2 — LOGADO: confirmar chama POST /api/recipes/import com a URL e navega à receita importada', async () => {
    sessionState = authed()
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS, {
      status: 201,
      body: { recipeId: 'imp-99', visibility: 'private' },
    })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: M.importarConfirmar }))

    // POST /api/recipes/import com a URL escolhida.
    await waitFor(() => {
      const importCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/recipes/import'))
      expect(importCall).toBeTruthy()
      const init = importCall![1] as RequestInit
      expect(init.method).toBe('POST')
      expect(JSON.parse(String(init.body))).toEqual({ url: WEB_LINKS[0].url })
    })
    // Sucesso (201) ⇒ navega à receita importada.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/recipes/imp-99'))
  })

  it('I3 — LOGADO: 422 (site sem JSON-LD) mostra erro "não importável" e NÃO navega', async () => {
    sessionState = authed()
    stubFetchRouting(emptyLocal, WEB_LINKS, { status: 422, body: { error: 'no_jsonld' } })
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: M.importarConfirmar }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.importarErroNaoImportavel)
    expect(push).not.toHaveBeenCalled()
  })

  it('I4 — VISITANTE: clicar num resultado da web abre o convite de entrar (não importa)', async () => {
    sessionState = anon()
    const fetchMock = stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))

    await screen.findByRole('dialog')
    // Convite de entrar (gerar/importar exige conta) — sem botão de confirmar import.
    expect(screen.getByText(M.importarConviteTitulo)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.nav.signIn })).toHaveAttribute('href', '/sign-in')
    expect(screen.queryByRole('button', { name: M.importarConfirmar })).not.toBeInTheDocument()
    // Nunca chamou o endpoint de import.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/import'))).toBe(false)
  })

  it('I5 — A11y: ESC fecha o modal', async () => {
    sessionState = authed()
    stubFetchRouting(emptyLocal, WEB_LINKS)
    const user = userEvent.setup()
    renderSearch()

    await user.type(screen.getByRole('searchbox'), 'feijoada')
    await user.click(await webTrigger(WEB_LINKS[0].title))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
