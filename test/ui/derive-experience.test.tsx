import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * Teste jsdom de "Criar minha versão" / derivar (#17 UI / #61). `fetch` mockado no shape REAL de
 * `POST /api/recipes/[id]/derive` (201 { recipeId }). `next/navigation` real-mock (router.push).
 * Asserções: abre o aviso de cópia, POSTa /derive, navega pra nova derivada, en-US, sem âmbar.
 */

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { DeriveExperience } from '@/components/recipe/derive-experience'

const M = ptBR.derivada
const MC = ptBR.minhasCriacoes

function baseView(over: Partial<RecipeView> = {}): RecipeView {
  return {
    id: 'base-1',
    name: 'Feijoada do catálogo',
    origin: 'catalog',
    schemaVersion: 1,
    body: { descricao: 'Clássico', passos: ['Cozinhe'], notas: null },
    facets: { cozinha: 'brasileira', categoria: 'prato_principal', tags: [] },
    porcoes: 6,
    dificuldade: 3,
    ingredients: [{ ordem: 0, quantidade: '2.500', unidade: 'kg', rawText: 'feijão' }],
    translations: [],
    autoTranslationSignal: false,
    ...over,
  }
}

function mockDerive(result: { status: number; body?: unknown }) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
    void _init
    // Só o /derive é exercido aqui; valida o roteamento da URL e devolve o desfecho.
    if (!String(input).includes('/derive')) throw new Error(`fetch não mockado: ${String(input)}`)
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderDerive(view: RecipeView, locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <DeriveExperience view={view} locale={locale} />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  push.mockClear()
  refresh.mockClear()
})

describe('DeriveExperience (#17/#61)', () => {
  it('T1 — abre o formulário com o aviso de CÓPIA, prefilled da base', async () => {
    const user = userEvent.setup()
    mockDerive({ status: 201, body: { recipeId: 'new-1' } })
    const { container } = renderDerive(baseView())

    await user.click(screen.getByRole('button', { name: MC.criarMinhaVersao }))
    expect(screen.getByText(M.copiaAviso)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Feijoada do catálogo')).toBeInTheDocument()
    // Aviso de cópia é NEUTRO (sem âmbar).
    expect(container.querySelector('[class*="aviso"]')).toBeNull()
  })

  it('T2 — submeter POSTa /derive e navega pra nova derivada', async () => {
    const user = userEvent.setup()
    const fetchMock = mockDerive({ status: 201, body: { recipeId: 'new-9' } })
    renderDerive(baseView())

    await user.click(screen.getByRole('button', { name: MC.criarMinhaVersao }))
    // Há dois botões "Criar minha versão" agora? Não — ao abrir, o gatilho some e o submit
    // aparece. Submete pelo botão de submit do form.
    await user.click(screen.getByRole('button', { name: MC.criarMinhaVersao }))

    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toContain('/api/recipes/base-1/derive')
    expect((call[1] as RequestInit).method).toBe('POST')
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.edits.titulo).toBe('Feijoada do catálogo')
    expect(push).toHaveBeenCalledWith('/recipes/new-9')
  })

  it('T3 — erro não-201: mensagem neutra, NÃO navega', async () => {
    const user = userEvent.setup()
    mockDerive({ status: 409, body: { error: 'derivar_da_propria' } })
    renderDerive(baseView())
    await user.click(screen.getByRole('button', { name: MC.criarMinhaVersao }))
    await user.click(screen.getByRole('button', { name: MC.criarMinhaVersao }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('T4 — en-US: CTA e aviso de cópia traduzidos', async () => {
    const user = userEvent.setup()
    mockDerive({ status: 201, body: { recipeId: 'x' } })
    renderDerive(baseView(), 'en-US')
    await user.click(screen.getByRole('button', { name: enUS.minhasCriacoes.criarMinhaVersao }))
    expect(screen.getByText(enUS.derivada.copiaAviso)).toBeInTheDocument()
  })
})
