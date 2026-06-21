import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom da ENTRADA INTELIGENTE (#112) — o textarea de ingredientes em
 * linguagem natural + o botão "Estruturar" que chama `POST /api/parse-ingredients` e PRÉ-PREENCHE
 * as linhas estruturadas que o Usuário finaliza. `fetch` é mockado no shape real da rota
 * (`{ items }`). Renderiza dentro do LocaleProvider; `next/link` e `@/lib/auth-client` mockados
 * (sem AppRouter/Better Auth no jsdom). A Extração ORGANIZA o que o Usuário escreveu — não gera
 * a Receita: por isso só toca /api/parse-ingredients, nunca /api/generations.
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
import { CreateStructuredExperience } from '@/components/recipe/create-structured-experience'

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

function renderCreate(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <CreateStructuredExperience />
    </LocaleProvider>,
  )
}

function makeResponse(r: { status: number; body: unknown }) {
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.body,
  } as Response
}

/** Textboxes das LINHAS de ingrediente, excluindo a textarea de entrada inteligente. */
function ingredientTextboxes(): HTMLElement[] {
  return screen
    .getAllByRole('textbox')
    .filter((el) => el.getAttribute('id') !== 'entrada-inteligente')
}

type Item = { rawText: string; quantidade: string | null; unidade: string | null; strength: string }

/** Mocka `fetch` para /api/parse-ingredients (POST). Outras URLs estouram (não deviam ser tocadas). */
function mockParse(result: { status: number; items?: Item[]; body?: unknown } | { reject: true }) {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (url.includes('/api/parse-ingredients')) {
      if ('reject' in result) throw new TypeError('network down')
      return makeResponse({ status: result.status, body: result.body ?? { items: result.items ?? [] } })
    }
    throw new Error(`fetch não esperado: ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

/** Pendura a resposta do POST e devolve uma alça para liberá-la (fixa o estado aria-busy). */
function mockParseDeferred() {
  let release!: (items: Item[]) => void
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    if (url.includes('/api/parse-ingredients')) {
      return new Promise<Response>((res) => {
        release = (items: Item[]) => res(makeResponse({ status: 200, body: { items } }))
      })
    }
    throw new Error(`fetch não esperado: ${url}`)
  })
  vi.stubGlobal('fetch', impl)
  return { impl, release: (items: Item[]) => release(items) }
}

beforeEach(() => {
  sessionState = authed()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Entrada inteligente (#112)', () => {
  it('E1 — textarea + botão Estruturar presentes no modo estruturado; copy de distinção visível', () => {
    renderCreate()
    expect(screen.getByLabelText(M.entradaInteligente)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: M.estruturar })).toBeInTheDocument()
    expect(screen.getByText(M.entradaDistincao)).toBeInTheDocument()
  })

  it('E2 — ausente no modo prompt aberto (free_text)', async () => {
    const user = userEvent.setup()
    renderCreate()
    const grupo = screen.getByRole('radiogroup', { name: M.modoLegenda })
    await user.click(within(grupo).getByRole('radio', { name: M.modoPromptAberto }))
    expect(screen.queryByLabelText(M.entradaInteligente)).toBeNull()
    expect(screen.queryByRole('button', { name: M.estruturar })).toBeNull()
  })

  it('E3 — botão desabilitado com < 10 caracteres, habilitado a partir de 10', async () => {
    const user = userEvent.setup()
    renderCreate()
    const btn = screen.getByRole('button', { name: M.estruturar })
    expect(btn).toBeDisabled()
    await user.type(screen.getByLabelText(M.entradaInteligente), '2 cebolas')
    // "2 cebolas" tem 9 chars → ainda desabilitado.
    expect(btn).toBeDisabled()
    await user.type(screen.getByLabelText(M.entradaInteligente), 's')
    expect(btn).toBeEnabled()
  })

  it('E4 — aria-busy enquanto busca (fetch pendurado), depois resolve', async () => {
    const user = userEvent.setup()
    const { release } = mockParseDeferred()
    renderCreate()

    await user.type(screen.getByLabelText(M.entradaInteligente), '2 cebolas, sal a gosto')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    // Pendurado: o botão mostra "Estruturando…", aria-busy, desabilitado.
    const busyBtn = screen.getByRole('button', { name: M.estruturando })
    expect(busyBtn).toHaveAttribute('aria-busy', 'true')
    expect(busyBtn).toBeDisabled()

    release([{ rawText: 'cebola', quantidade: '2', unidade: 'unidade', strength: 'required' }])
    // Volta para "Estruturar" após resolver.
    expect(await screen.findByRole('button', { name: M.estruturar })).toBeInTheDocument()
  })

  it('E5 — linhas extraídas substituem a linha-default vazia e a textarea é limpa', async () => {
    const user = userEvent.setup()
    mockParse({
      status: 200,
      items: [
        { rawText: 'cebola', quantidade: '2', unidade: 'unidade', strength: 'required' },
        { rawText: 'sal', quantidade: null, unidade: 'a_gosto', strength: 'required' },
      ],
    })
    renderCreate()

    await user.type(screen.getByLabelText(M.entradaInteligente), '2 cebolas, sal a gosto')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    // As duas linhas aparecem (rawText preenchido); a linha-default vazia NÃO empilhou.
    expect(await screen.findByDisplayValue('cebola')).toBeInTheDocument()
    expect(screen.getByDisplayValue('sal')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    // Exatamente 2 rótulos de ingrediente (sem uma 3ª linha-default vazia).
    expect(screen.getByText(`${M.ingrediente} 1`)).toBeInTheDocument()
    expect(screen.getByText(`${M.ingrediente} 2`)).toBeInTheDocument()
    expect(screen.queryByText(`${M.ingrediente} 3`)).toBeNull()
    // Textarea limpa no sucesso.
    expect(screen.getByLabelText(M.entradaInteligente)).toHaveValue('')
  })

  it('E6 — APPEND preserva linhas já preenchidas (não substitui)', async () => {
    const user = userEvent.setup()
    mockParse({
      status: 200,
      items: [{ rawText: 'tomate', quantidade: '3', unidade: 'unidade', strength: 'required' }],
    })
    renderCreate()

    // Preenche a 1ª linha à mão.
    const inputs = ingredientTextboxes()
    await user.type(inputs[0], 'alho')

    await user.type(screen.getByLabelText(M.entradaInteligente), '3 tomates maduros')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    // 'alho' permanece + 'tomate' foi APPENDado.
    expect(await screen.findByDisplayValue('tomate')).toBeInTheDocument()
    expect(screen.getByDisplayValue('alho')).toBeInTheDocument()
    expect(screen.getByText(`${M.ingrediente} 2`)).toBeInTheDocument()
  })

  it('E7 — unidade null vira erro por-linha; troca de unidade no select limpa o erro', async () => {
    const user = userEvent.setup()
    mockParse({
      status: 200,
      items: [{ rawText: 'leite', quantidade: '1', unidade: null, strength: 'required' }],
    })
    renderCreate()

    await user.type(screen.getByLabelText(M.entradaInteligente), '1 galão de leite')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    expect(await screen.findByText(M.itemUnidadeDesconhecida)).toBeInTheDocument()

    // Escolher uma unidade no <select> da linha LIMPA o erro.
    const selects = screen.getAllByRole('combobox')
    // O primeiro combobox é o <select> de unidade da 1ª linha de ingrediente.
    fireEvent.change(selects[0], { target: { value: 'l' } })
    expect(screen.queryByText(M.itemUnidadeDesconhecida)).toBeNull()
  })

  it('E8 — non-ok (502) mostra erroEstruturacao e DEIXA as linhas intactas', async () => {
    const user = userEvent.setup()
    mockParse({ status: 502, body: { error: 'extracao_falhou' } })
    renderCreate()

    // Preenche a 1ª linha à mão (deve sobreviver ao erro).
    const inputs = ingredientTextboxes()
    await user.type(inputs[0], 'cebola roxa')

    await user.type(screen.getByLabelText(M.entradaInteligente), 'algo que falha na extração')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    expect(await screen.findByText(M.erroEstruturacao)).toBeInTheDocument()
    // Linha existente intacta.
    expect(screen.getByDisplayValue('cebola roxa')).toBeInTheDocument()
    // Apenas a linha que o Usuário tinha (sem itens novos).
    expect(screen.queryByText(`${M.ingrediente} 2`)).toBeNull()
  })

  it('E9 — rede (reject) também mostra erroEstruturacao, linhas intactas', async () => {
    const user = userEvent.setup()
    mockParse({ reject: true })
    renderCreate()

    await user.type(screen.getByLabelText(M.entradaInteligente), 'cai a rede no meio')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    expect(await screen.findByText(M.erroEstruturacao)).toBeInTheDocument()
  })

  it('E10 — Gerar receita NÃO é travado durante a extração (só o botão Estruturar)', async () => {
    const user = userEvent.setup()
    const { release } = mockParseDeferred()
    renderCreate()

    await user.type(screen.getByLabelText(M.entradaInteligente), '2 cebolas, sal a gosto')
    await user.click(screen.getByRole('button', { name: M.estruturar }))

    // Enquanto extrai: "Gerar receita" continua habilitado (a extração não bloqueia a geração).
    expect(screen.getByRole('button', { name: M.gerar })).toBeEnabled()

    release([{ rawText: 'cebola', quantidade: '2', unidade: 'unidade', strength: 'required' }])
    await screen.findByRole('button', { name: M.estruturar })
  })

  it('E11 — en-US: rótulos da entrada inteligente seguem o locale', () => {
    renderCreate('en-US')
    expect(screen.getByLabelText(enUS.criar.entradaInteligente)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.criar.estruturar })).toBeInTheDocument()
    expect(screen.getByText(enUS.criar.entradaDistincao)).toBeInTheDocument()
  })
})
