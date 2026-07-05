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
