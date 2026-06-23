import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste de COMPONENTE jsdom do WIZARD estruturado de 3 passos (#193) dentro do drawer "Nova
 * receita" (#191, ADR-0021). Exercita o caminho `estruturado` ponta-a-ponta: navegação dos 3
 * passos (stepper), os dois modos de ingrediente (um-a-um/pager e de-uma-vez/bulk), Voltar
 * preservando o estado, e "Gerar receita" disparando POST mode `structured` → gerando → gerada,
 * reusando o pipeline de resultado/cap/erro do spine.
 *
 * `fetch` é mockado no SHAPE REAL das rotas (espelha create-drawer.test.tsx): POST
 * /api/generations (`{ outcome, recipeId, advisory }`) e GET /api/recipes/{id} (RecipeView CRU).
 * `next/link` e `@/lib/auth-client` mockados. Polyfills de Radix vêm de test/ui/setup.ts.
 */

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
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { CreateDrawer } from '@/components/recipe/create-drawer'

const D = ptBR.criarDrawer
const W = ptBR.criarWizard
const M = ptBR.criar

function authed(): SessionState {
  return {
    data: { user: { id: 'u-1', name: 'Ana' }, session: { id: 's-1' } },
    error: null,
    isPending: false,
    isRefetching: false,
    refetch: vi.fn(),
  }
}

function Harness(props: { locale?: Locale }) {
  const { locale = 'pt-BR' } = props
  const [open, setOpen] = useState(true)
  return (
    <LocaleProvider initialLocale={locale}>
      <CreateDrawer open={open} onOpenChange={setOpen} />
    </LocaleProvider>
  )
}

function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'r-1',
    name: 'Feijão tropeiro',
    origin: 'ai_structured',
    schemaVersion: 1,
    body: { descricao: 'Um prato mineiro.', passos: ['Refogue', 'Misture'], notas: null },
    facets: { cozinha: 'mineira', categoria: 'prato_principal', tags: [] },
    porcoes: 4,
    dificuldade: 2,
    ingredients: [{ ordem: 1, quantidade: '2.000', unidade: 'xicara', rawText: 'feijão' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

type FetchResult = { status: number; body: unknown } | { reject: true }

function makeResponse(r: { status: number; body: unknown }) {
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body } as Response
}

function mockFetch(opts: {
  generations: FetchResult | (() => Promise<FetchResult>)
  recipes?: FetchResult
}) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (url.includes('/api/generations')) {
      const r = typeof opts.generations === 'function' ? await opts.generations() : opts.generations
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    if (url.includes('/api/recipes/')) {
      const r = opts.recipes ?? { status: 404, body: { error: 'not_found' } }
      if ('reject' in r) throw new TypeError('network down')
      return makeResponse(r)
    }
    throw new Error(`fetch não mockado: ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function deferred() {
  let release!: (r: FetchResult) => void
  const factory = () => new Promise<FetchResult>((res) => (release = res))
  return { factory, release: (r: FetchResult) => release(r) }
}

function drawer() {
  return screen.getByRole('dialog')
}

/** Abre o caminho estruturado do método-picker. */
async function abrirWizard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: new RegExp(D.metodoEstruturadoTitulo) }))
}

beforeEach(() => {
  sessionState = authed()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CreateDrawer — wizard estruturado (#193)', () => {
  it('W1 — escolher "Formulário estruturado" abre o passo 1 (Ingredientes) com stepper, não o placeholder', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirWizard(user)

    // Não é mais o placeholder "em breve" (o card estruturado virou o wizard real, #193).
    expect(screen.queryByText(D.emBreve)).toBeNull()
    // Título do diálogo vira "Formulário estruturado"; passo 1 visível.
    expect(drawer()).toHaveAccessibleName(D.tituloEstruturado)
    expect(screen.getByRole('heading', { name: W.ingredientesTitulo })).toBeInTheDocument()
    // O stepper anuncia o passo atual (nome acessível do <ol> de passos).
    expect(screen.getByRole('list', { name: W.passoLabel.replace('{n}', '1') })).toBeInTheDocument()
  })

  it('W2 — navega os 3 passos com "Continuar"; "Gerar receita" só no passo 3', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirWizard(user)

    // Passo 1 → 2 (Cozinha + Restrições).
    await user.click(screen.getByRole('button', { name: W.continuar }))
    expect(screen.getByRole('heading', { name: W.cozinhaTitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: W.restricoesTitulo })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: W.passoLabel.replace('{n}', '2') })).toBeInTheDocument()

    // Passo 2 → 3 (Detalhes): porções/dificuldade/observações; CTA vira "Gerar receita".
    await user.click(screen.getByRole('button', { name: W.continuar }))
    expect(screen.getByRole('heading', { name: W.porcoesTitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: W.dificuldadeTitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: W.observacoesTitulo })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: W.passoLabel.replace('{n}', '3') })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: W.continuar })).toBeNull()
    expect(screen.getByRole('button', { name: W.gerar })).toBeInTheDocument()
  })

  it('W3 — modo "um a um": adicionar, navegar pelo pager e preencher itens distintos', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirWizard(user)

    // Modo um-a-um é o default: o pager mostra "Ingrediente 1 de 1".
    expect(screen.getByText(W.itemPosicao.replace('{atual}', '1').replace('{total}', '1'))).toBeInTheDocument()

    // Preenche o item 1.
    const nome1 = screen.getByPlaceholderText(/cebola grande/i)
    await user.type(nome1, 'cebola roxa')

    // Adiciona outro → vai pro item 2 (pager "2 de 2"), campo limpo. (o botão tem o prefixo "+")
    await user.click(screen.getByRole('button', { name: new RegExp(W.adicionarOutro) }))
    expect(screen.getByText(W.itemPosicao.replace('{atual}', '2').replace('{total}', '2'))).toBeInTheDocument()
    const nome2 = screen.getByPlaceholderText(/cebola grande/i)
    expect(nome2).toHaveValue('')
    await user.type(nome2, 'alho-poró')

    // Volta pro item 1 pelo botão "anterior": o valor preenchido foi preservado.
    await user.click(screen.getByRole('button', { name: W.itemAnterior }))
    expect(screen.getByText(W.itemPosicao.replace('{atual}', '1').replace('{total}', '2'))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/cebola grande/i)).toHaveValue('cebola roxa')
  })

  it('W4 — alterna para "de uma vez": textarea bulk substitui o pager', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirWizard(user)

    // Pager visível no default.
    expect(screen.getByText(W.itemPosicao.replace('{atual}', '1').replace('{total}', '1'))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: W.modoDeUmaVez }))
    // O pager some; a textarea bulk aparece.
    expect(screen.queryByText(W.itemPosicao.replace('{atual}', '1').replace('{total}', '1'))).toBeNull()
    expect(screen.getByLabelText(W.bulkLabel)).toBeInTheDocument()
  })

  it('W5 — "Voltar" do passo 2 ao 1 preserva o ingrediente digitado', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await abrirWizard(user)

    await user.type(screen.getByPlaceholderText(/cebola grande/i), 'tomate')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    expect(screen.getByRole('heading', { name: W.cozinhaTitulo })).toBeInTheDocument()

    // "Voltar" (rodapé) retorna ao passo 1 SEM perder o estado. Há dois controles "Voltar" (o `‹`
    // do header e o botão do rodapé) — ambos fazem o MESMO step-back; clicamos o do rodapé (último).
    const voltares = screen.getAllByRole('button', { name: D.voltar })
    await user.click(voltares[voltares.length - 1])
    expect(screen.getByRole('heading', { name: W.ingredientesTitulo })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/cebola grande/i)).toHaveValue('tomate')
  })

  it('W6 — gera ponta-a-ponta: POST mode `structured` com o Briefing → gerando → gerada', async () => {
    const user = userEvent.setup()
    const d = deferred()
    const fetchMock = mockFetch({
      generations: d.factory,
      recipes: { status: 200, body: baseView() },
    })
    render(<Harness />)
    await abrirWizard(user)

    // Passo 1: um ingrediente.
    await user.type(screen.getByPlaceholderText(/cebola grande/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    // Passo 2 → 3.
    await user.click(screen.getByRole('button', { name: W.continuar }))
    // Gera.
    await user.click(screen.getByRole('button', { name: W.gerar }))

    // Estado GERANDO: botão "Gerando receita…".
    expect(await screen.findByRole('button', { name: M.gerando })).toBeInTheDocument()

    // O POST foi `structured` e levou o item no Briefing.
    const postCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generations'))
    expect(postCall).toBeDefined()
    const body = JSON.parse(String((postCall![1] as RequestInit).body))
    expect(body.mode).toBe('structured')
    expect(body.briefing.itens[0].rawText).toBe('feijão')

    // Libera o POST (201) → GET (200) → GERADA. #231 (ADR-0020): o 201 devolve slug+locale (#229).
    d.release({
      status: 201,
      body: { outcome: 'success', recipeId: 'r-1', advisory: null, slug: 'feijao-tropeiro', locale: 'pt-BR' },
    })
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
    // "Ver receita" linka o canônico `/{locale}/recipes/<slug>` (#231), nunca o link nu.
    expect(screen.getByRole('link', { name: M.verReceita })).toHaveAttribute(
      'href',
      '/pt-BR/recipes/feijao-tropeiro',
    )
  })

  it('W7 — bulk: as linhas viram itens do Briefing no POST', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } },
      recipes: { status: 200, body: baseView() },
    })
    render(<Harness />)
    await abrirWizard(user)

    await user.click(screen.getByRole('button', { name: W.modoDeUmaVez }))
    await user.type(screen.getByLabelText(W.bulkLabel), '2 xícaras de fubá\n1 cebola')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/generations'))
      expect(postCall).toBeDefined()
      const body = JSON.parse(String((postCall![1] as RequestInit).body))
      expect(body.mode).toBe('structured')
      const textos = body.briefing.itens.map((i: { rawText: string }) => i.rawText)
      expect(textos).toContain('2 xícaras de fubá')
      expect(textos).toContain('1 cebola')
    })
  })

  it('W8 — cap 429 dentro do wizard: mensagem amigável, sem GET, sem travar', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetch({
      generations: { status: 429, body: { error: 'limite_geracao', retryAfterMs: 3_600_000 } },
    })
    render(<Harness />)
    await abrirWizard(user)

    await user.type(screen.getByPlaceholderText(/cebola grande/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(M.erroLimiteGeracao)
    // Nunca tocou o GET (429 antes da IA → não consumiu cap).
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/recipes/'))).toBe(false)
    // Botão "Gerar receita" segue acionável.
    expect(screen.getByRole('button', { name: W.gerar })).toBeEnabled()
  })

  it('W9 — ao gerar dentro do wizard: o nome da Receita é o ÚNICO <h1> (seam de heading/foco)', async () => {
    const user = userEvent.setup()
    mockFetch({
      generations: { status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } },
      recipes: { status: 200, body: baseView() },
    })
    render(<Harness />)
    await abrirWizard(user)

    await user.type(screen.getByPlaceholderText(/cebola grande/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))

    const h1 = await screen.findByRole('heading', { level: 1, name: baseView().name })
    expect(h1).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('W11 — o `‹` do header não orfana a geração: trava enquanto gera (ADR-0021 dec.5)', async () => {
    const user = userEvent.setup()
    const d = deferred()
    const fetchMock = mockFetch({
      generations: d.factory,
      recipes: { status: 200, body: baseView() },
    })
    render(<Harness />)
    await abrirWizard(user)

    // Monta um Briefing mínimo e dispara "Gerar receita" (POST em voo, não resolvido).
    await user.type(screen.getByPlaceholderText(/cebola grande/i), 'feijão')
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.continuar }))
    await user.click(screen.getByRole('button', { name: W.gerar }))
    expect(await screen.findByRole('button', { name: M.gerando })).toBeInTheDocument()

    // O `‹` do header (1º controle "Voltar") está DESABILITADO enquanto gera — clicar é no-op.
    const back = screen.getAllByRole('button', { name: D.voltar })[0]
    expect(back).toBeDisabled()
    await user.click(back)

    // O wizard NÃO desmontou: o diálogo segue "Formulário estruturado" e ainda em "Gerando".
    expect(drawer()).toHaveAccessibleName(D.tituloEstruturado)
    expect(screen.getByRole('button', { name: M.gerando })).toBeInTheDocument()
    // Nenhum 2º POST disparado pelo clique no `‹`.
    const posts = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/generations'))
    expect(posts).toHaveLength(1)

    // Ao resolver, conclui normalmente (sem geração órfã).
    d.release({ status: 201, body: { outcome: 'success', recipeId: 'r-1', advisory: null } })
    expect(await screen.findByText(M.resultadoSucesso)).toBeInTheDocument()
  })

  it('W10 — en-US: o wizard estruturado aparece traduzido (paridade i18n, ADR-0001)', async () => {
    const user = userEvent.setup()
    render(<Harness locale="en-US" />)
    await user.click(
      screen.getByRole('button', { name: new RegExp(enUS.criarDrawer.metodoEstruturadoTitulo) }),
    )
    expect(
      screen.getByRole('heading', { name: enUS.criarWizard.ingredientesTitulo }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.criarWizard.continuar })).toBeInTheDocument()
  })
})
