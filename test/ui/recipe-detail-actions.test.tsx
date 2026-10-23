import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste jsdom das afordâncias do detalhe (#61) APÓS a #192/ADR-0021: a edição IN-PLACE vira um
 * MODAL centrado (o detalhe é SÓ-LEITURA — sem form de edição inline). Para o DONO, o bloco de
 * gestão mostra o GATILHO "Editar" (botão), NÃO os campos do form (eles só aparecem quando o
 * modal abre). `useSession`/`next/navigation`/`next/link` mockados (sem AppRouter/Better Auth).
 */

const refresh = vi.fn()
const push = vi.fn()
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push, replace }),
  // #458: usePathname alimenta o `?returnTo=` do convite de entrar (não-dono anônimo).
  usePathname: () => '/receitas/bolo-de-cenoura',
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
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

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { RecipeDetailActions } from '@/components/recipe/recipe-detail-actions'
import { REPORT_REASON_MAX } from '@/domain/report'

function ownerView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Bolo simples',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Doce caseiro', passos: ['Misture', 'Asse'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'sobremesa', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 0, quantidade: '2.000', unidade: 'xicara', rawText: 'farinha' }],
    translations: [],
    autoTranslationSignal: false,
    canManage: true,
    visibility: 'private',
    resultKind: 'success',
    ...over,
  }
}

function renderActions(view: RecipeView) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <RecipeDetailActions view={view} locale="pt-BR" />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  refresh.mockClear()
  push.mockClear()
})

describe('RecipeDetailActions após #192 (detalhe só-leitura)', () => {
  it('dono: mostra o GATILHO "Editar" mas NÃO o form de edição inline (campos só aparecem no modal)', () => {
    sessionState = {
      data: { user: { id: 'u-1' } },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    }
    renderActions(ownerView())

    // O botão "Editar" (gatilho do modal) está presente.
    expect(screen.getByRole('button', { name: ptBR.minhasCriacoes.editar })).toBeInTheDocument()

    // Nenhum dialog/modal montado de saída (fechado por padrão).
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // O form de edição NÃO está inline: os campos de conteúdo (título prefilled, ingrediente,
    // salvar) NÃO aparecem antes de abrir o modal — a tela de detalhe é só-leitura.
    expect(screen.queryByDisplayValue('Bolo simples')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: ptBR.criar.adicionarIngrediente }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: ptBR.edicaoPropria.editarPublicaConfirmar }),
    ).not.toBeInTheDocument()
  })
})

/**
 * #196/ADR-0021: numa Receita NÃO-própria, o autenticado vê "Criar minha versão" — que abre o
 * MESMO modal (compartilhado, `RecipeEditModal mode="derive"`), não mais o form inline da antiga
 * `DeriveExperience`. O conteúdo só aparece ao abrir o modal (detalhe só-leitura).
 */
function nonOwnerView(over: Partial<RecipeView> = {}): RecipeView {
  return { ...ownerView(), canManage: false, visibility: undefined, ...over }
}

describe('RecipeDetailActions — não-dono autenticado deriva no modal (#196)', () => {
  it('mostra o gatilho "Criar minha versão" e nenhum form inline (detalhe só-leitura)', () => {
    sessionState = {
      data: { user: { id: 'u-1' } },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    }
    renderActions(nonOwnerView({ origin: 'catalog' }))

    expect(
      screen.getByRole('button', { name: ptBR.minhasCriacoes.criarMinhaVersao }),
    ).toBeInTheDocument()
    // Nenhum modal montado de saída; nenhum campo inline.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Bolo simples')).not.toBeInTheDocument()
  })

  it('clicar "Criar minha versão" abre o modal compartilhado prefilled da base', async () => {
    const user = userEvent.setup()
    sessionState = {
      data: { user: { id: 'u-1' } },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    }
    renderActions(nonOwnerView({ origin: 'catalog' }))

    await user.click(screen.getByRole('button', { name: ptBR.minhasCriacoes.criarMinhaVersao }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName(ptBR.edicaoPropria.modalDerivarTitulo)
    // Prefilled da base; sem Apagar (não é sua).
    expect(screen.getByDisplayValue('Bolo simples')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: ptBR.minhasCriacoes.apagar }),
    ).not.toBeInTheDocument()
  })
})

/**
 * ADR-0045: "Clonar" ao lado de "Criar minha versão" — a cópia num clique, sem o modal. POST
 * /derive com `{ clone: true }` e navega pra nova Receita.
 */
describe('RecipeDetailActions — Clonar num clique (ADR-0045)', () => {
  function logado() {
    sessionState = {
      data: { user: { id: 'u-1' } },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: vi.fn(),
    }
  }

  it('clicar "Clonar" faz o POST de clone e navega pra cópia, sem abrir o modal', async () => {
    const user = userEvent.setup()
    logado()
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ recipeId: 'nova-1', imageReviewSuggested: false }), { status: 201 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderActions(nonOwnerView({ origin: 'catalog' }))

    await user.click(screen.getByRole('button', { name: ptBR.minhasCriacoes.clonar }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recipes/r-1/derive?locale=pt-BR')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ clone: true })
    expect(push).toHaveBeenCalledWith(expect.stringContaining('nova-1'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('falha no clone ⇒ mensagem neutra e o botão volta a ficar clicável', async () => {
    const user = userEvent.setup()
    logado()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    renderActions(nonOwnerView({ origin: 'catalog' }))

    await user.click(screen.getByRole('button', { name: ptBR.minhasCriacoes.clonar }))

    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.minhasCriacoes.clonarErro)
    expect(screen.getByRole('button', { name: ptBR.minhasCriacoes.clonar })).toBeEnabled()
    expect(push).not.toHaveBeenCalled()
  })

  it('#588 — 429 limite_derivar ⇒ mensagem do teto com o tempo até liberar; botão volta a ficar clicável', async () => {
    const user = userEvent.setup()
    logado()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'limite_derivar', retryAfterMs: 20 * 60_000 }), { status: 429 }),
      ),
    )
    renderActions(nonOwnerView({ origin: 'catalog' }))

    await user.click(screen.getByRole('button', { name: ptBR.minhasCriacoes.clonar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(ptBR.minhasCriacoes.derivarLimite.replace('{tempo}', '20min'))
    expect(alert).not.toHaveTextContent(ptBR.minhasCriacoes.clonarErro)
    expect(screen.getByRole('button', { name: ptBR.minhasCriacoes.clonar })).toBeEnabled()
    expect(push).not.toHaveBeenCalled()
  })

  it('visitante não vê "Clonar" (só o convite de entrar)', () => {
    sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
    renderActions(nonOwnerView({ origin: 'catalog' }))
    expect(screen.queryByRole('button', { name: ptBR.minhasCriacoes.clonar })).not.toBeInTheDocument()
  })

  it('o dono não vê "Clonar" (a própria se edita no lugar)', () => {
    logado()
    renderActions(ownerView())
    expect(screen.queryByRole('button', { name: ptBR.minhasCriacoes.clonar })).not.toBeInTheDocument()
  })
})

/**
 * #605: "Reportar" na página da Receita — só logado e não-dono. O botão revela o motivo; "Enviar denúncia" faz o
 * POST /api/recipes/[id]/report {reason} e vira "Denúncia enviada"; 429 tem mensagem própria; falha deixa tentar.
 */
describe('RecipeDetailActions — Reportar a Receita (#605)', () => {
  const d = ptBR.denunciaReceita
  function logado() {
    sessionState = { data: { user: { id: 'u-1' } }, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
  }

  it('dono e Visitante não veem "Reportar"', () => {
    logado()
    const { unmount } = renderActions(ownerView())
    expect(screen.queryByRole('button', { name: d.reportar })).not.toBeInTheDocument()
    unmount()
    sessionState = { data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }
    renderActions(nonOwnerView())
    expect(screen.queryByRole('button', { name: d.reportar })).not.toBeInTheDocument()
  })

  it('logado não-dono: motivo obrigatório, envia o POST e mostra "Denúncia enviada"', async () => {
    const user = userEvent.setup()
    logado()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reportId: 'rep-1' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    renderActions(nonOwnerView())

    await user.click(screen.getByRole('button', { name: d.reportar }))
    const enviar = screen.getByRole('button', { name: d.enviar })
    expect(enviar).toBeDisabled()
    await user.type(screen.getByLabelText(d.motivo), '  cópia de um livro  ')
    await user.click(enviar)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/recipes/r-1/report')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'cópia de um livro' })
    expect(await screen.findByRole('status')).toHaveTextContent(d.enviada)
    expect(screen.queryByRole('button', { name: d.reportar })).not.toBeInTheDocument()
  })

  it('Cancelar fecha o form sem chamar nada', async () => {
    const user = userEvent.setup()
    logado()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderActions(nonOwnerView())
    await user.click(screen.getByRole('button', { name: d.reportar }))
    await user.click(screen.getByRole('button', { name: d.cancelar }))
    expect(screen.queryByLabelText(d.motivo)).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('429 ⇒ mensagem do limite; outra falha ⇒ erro neutro e dá para tentar de novo', async () => {
    const user = userEvent.setup()
    logado()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'limite_denuncias' }), { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    renderActions(nonOwnerView())
    await user.click(screen.getByRole('button', { name: d.reportar }))
    await user.type(screen.getByLabelText(d.motivo), 'spam')
    await user.click(screen.getByRole('button', { name: d.enviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(d.erroLimite)

    await user.click(screen.getByRole('button', { name: d.enviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(d.erro)
    expect(screen.getByRole('button', { name: d.enviar })).toBeEnabled()
  })

  it('404 ⇒ "não está mais disponível"; 401 ⇒ pede para entrar de novo', async () => {
    const user = userEvent.setup()
    logado()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'nao_autenticado' }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    renderActions(nonOwnerView())
    await user.click(screen.getByRole('button', { name: d.reportar }))
    await user.type(screen.getByLabelText(d.motivo), 'spam')
    await user.click(screen.getByRole('button', { name: d.enviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(d.erroIndisponivel)
    await user.click(screen.getByRole('button', { name: d.enviar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(d.erroSessao)
  })

  it('foco: Cancelar devolve ao "Reportar"; enviar leva à confirmação; motivo com teto REPORT_REASON_MAX', async () => {
    const user = userEvent.setup()
    logado()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ reportId: 'rep-1' }), { status: 201 })))
    renderActions(nonOwnerView())
    await user.click(screen.getByRole('button', { name: d.reportar }))
    expect(screen.getByLabelText(d.motivo)).toHaveFocus()
    expect(screen.getByLabelText(d.motivo)).toHaveAttribute('maxLength', String(REPORT_REASON_MAX))
    await user.click(screen.getByRole('button', { name: d.cancelar }))
    expect(screen.getByRole('button', { name: d.reportar })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: d.reportar }))
    await user.type(screen.getByLabelText(d.motivo), 'cópia')
    await user.click(screen.getByRole('button', { name: d.enviar }))
    expect(await screen.findByRole('status')).toHaveFocus()
  })
})
