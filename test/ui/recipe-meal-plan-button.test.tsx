import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do botão de calendário do detalhe (`RecipeMealPlanButton`, ADR-0035 dec.4) — espelha
 * `recipe-shopping-list-button.test.tsx`. Os dias oferecidos são os 7 a partir de HOJE no relógio do
 * navegador: fixado em quarta 30/09/2026 (`vi.setSystemTime`, só `Date`). Porções vêm do escalador
 * da página (`PortionScaleProvider`) e só vão no POST quando a Receita declara porções.
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
import { PortionScaleProvider } from '@/components/recipe/recipe-portion-scale-context'
import { RecipeMealPlanButton } from '@/components/recipe/recipe-meal-plan-button'
import { capitalizeFirst, formatShortDay, formatWeekday } from '@/components/meal-plan/meal-plan-format'

const M = ptBR.cardapio

type FetchResult = { status: number; body: unknown }

function mockFetch(post: FetchResult = { status: 201, body: {} }) {
  const impl = vi.fn(async () => ({
    ok: post.status >= 200 && post.status < 300,
    status: post.status,
    json: async () => post.body,
  }) as Response)
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderButton(opts: { originalPorcoes: number; porcoesReceita: number | null }) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <PortionScaleProvider originalPorcoes={opts.originalPorcoes}>
        <RecipeMealPlanButton recipeId="r-1" porcoesReceita={opts.porcoesReceita} />
      </PortionScaleProvider>
    </LocaleProvider>,
  )
}

function postBody(impl: ReturnType<typeof mockFetch>) {
  const call = impl.mock.calls.find((c) => String((c as unknown[])[0]) === '/api/me/meal-plan/entries') as
    | unknown[]
    | undefined
  expect(call).toBeDefined()
  const init = call?.[1] as RequestInit
  expect(init.method).toBe('POST')
  return JSON.parse(String(init.body))
}

beforeEach(() => {
  vi.setSystemTime(new Date(2026, 8, 30, 19, 0, 0)) // quarta 30/09/2026, 19h: refeição padrão = jantar
  setSession('logged-in')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecipeMealPlanButton (ADR-0035 dec.4)', () => {
  it('Visitante: link /sign-in com returnTo, sem popover nem fetch', () => {
    setSession('anon')
    const impl = mockFetch()
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })
    expect(screen.getByRole('link', { name: M.convidaEntrar })).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Frecipes%2Fbolo-de-cenoura',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(impl).not.toHaveBeenCalled()
  })

  it('sessão carregando: não renderiza nada', () => {
    setSession('pending')
    const { container } = renderButton({ originalPorcoes: 4, porcoesReceita: 4 })
    expect(container).toBeEmptyDOMElement()
  })

  it('logado: abre o popover com 7 dias a partir de hoje (o 1º é "Hoje", selecionado)', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })
    const trigger = screen.getByRole('button', { name: M.planejarReceita })
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const hoje = await screen.findByRole('button', { name: M.hoje })
    expect(hoje).toHaveAttribute('aria-pressed', 'true')
    for (const d of ['2026-10-01', '2026-10-06']) {
      expect(screen.getByRole('button', { name: capitalizeFirst(formatShortDay(d, 'pt-BR')) })).toHaveAttribute('aria-pressed', 'false')
    }
    expect(screen.queryByRole('button', { name: capitalizeFirst(formatShortDay('2026-10-07', 'pt-BR')) })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: M.refeicao })).toHaveValue('jantar')
    expect(screen.getByText(M.porcoesValor.replace('{n}', '4'))).toBeInTheDocument()
  })

  it('escolhe dia + refeição e POSTa com porcoes (Receita COM porções); sucesso linka a semana do dia', async () => {
    const user = userEvent.setup()
    const impl = mockFetch()
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })
    await user.click(screen.getByRole('button', { name: M.planejarReceita }))

    // Segunda seguinte (05/10): a semana do link é a de 05/10, não a de hoje.
    const chip = await screen.findByRole('button', { name: capitalizeFirst(formatShortDay('2026-10-05', 'pt-BR')) })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await user.selectOptions(screen.getByRole('combobox', { name: M.refeicao }), 'almoco')
    await user.click(screen.getByRole('button', { name: M.planejar }))

    const success = M.planejadaEm
      .replace('{dia}', formatWeekday('2026-10-05', 'pt-BR'))
      .replace('{refeicao}', M.slotAlmoco.toLowerCase())
    expect(await screen.findByText(success, { exact: false })).toBeInTheDocument()
    expect(postBody(impl)).toEqual({ recipeId: 'r-1', day: '2026-10-05', slot: 'almoco', porcoes: 4 })
    expect(screen.getByRole('link', { name: M.verCardapio })).toHaveAttribute(
      'href',
      '/me/meal-plan?semana=2026-10-05',
    )
  })

  it('dia dentro da semana atual: link ?semana=<segunda da semana de hoje>', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })
    await user.click(screen.getByRole('button', { name: M.planejarReceita }))
    await user.click(await screen.findByRole('button', { name: M.planejar }))
    expect(await screen.findByRole('link', { name: M.verCardapio })).toHaveAttribute(
      'href',
      '/me/meal-plan?semana=2026-09-28',
    )
  })

  it('Receita SEM porções (porcoesReceita null): NÃO manda porcoes nem mostra o valor', async () => {
    const user = userEvent.setup()
    const impl = mockFetch()
    renderButton({ originalPorcoes: 1, porcoesReceita: null })
    await user.click(screen.getByRole('button', { name: M.planejarReceita }))
    expect(screen.queryByText(M.porcaoValor)).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: M.planejar }))

    await waitFor(() => expect(impl).toHaveBeenCalled())
    expect(postBody(impl)).toEqual({ recipeId: 'r-1', day: '2026-09-30', slot: 'jantar' })
  })

  it('erro dia_cheio: mensagem localizada, sem link de sucesso', async () => {
    const user = userEvent.setup()
    mockFetch({ status: 409, body: { error: 'dia_cheio' } })
    renderButton({ originalPorcoes: 4, porcoesReceita: 4 })
    await user.click(screen.getByRole('button', { name: M.planejarReceita }))
    await user.click(await screen.findByRole('button', { name: M.planejar }))
    expect(await screen.findByText(M.erroDiaCheio)).toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('link', { name: M.verCardapio })).not.toBeInTheDocument()
  })
})
