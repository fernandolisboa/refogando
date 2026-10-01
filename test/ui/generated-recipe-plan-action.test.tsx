import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do "Pôr no cardápio" do resultado da criação (`GeneratedRecipePlanAction`, ADR-0040).
 * Com alvo (a `/create` aberta pelo "Criar receita nova" de uma refeição do Cardápio) é um toque só,
 * para aquele dia e refeição, sem porções (as da Receita). Sem alvo, abre o painel de dia + refeição.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { GeneratedRecipePlanAction } from '@/components/meal-plan/generated-recipe-plan-action'
import { MealPlanTargetProvider } from '@/components/meal-plan/meal-plan-target-context'
import { formatShortDay } from '@/components/meal-plan/meal-plan-format'
import type { MealPlanTarget } from '@/domain/meal-plan'

const M = ptBR.cardapio

type Call = { url: string; method: string; body: unknown }

function mockFetch(status = 201, payload: unknown = {}) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body != null ? JSON.parse(String(init.body)) : undefined,
      })
      return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response
    }),
  )
  return calls
}

function tree(target: MealPlanTarget | null, recipeId = 'r-nova') {
  return (
    <LocaleProvider initialLocale="pt-BR">
      <MealPlanTargetProvider value={target}>
        <GeneratedRecipePlanAction recipeId={recipeId} />
      </MealPlanTargetProvider>
    </LocaleProvider>
  )
}

function renderAction(target: MealPlanTarget | null) {
  return render(tree(target))
}

// Hoje = quinta, 01/10/2026 (semana de 28/09). Só `Date` é falsificado: os timers do user-event seguem reais.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('GeneratedRecipePlanAction (ADR-0040)', () => {
  const target: MealPlanTarget = { day: '2026-10-06', slot: 'jantar' }
  const rotulo = M.porNoCardapioAlvo.replace('{dia}', formatShortDay(target.day, 'pt-BR')).replace('{refeicao}', 'jantar')

  it('com alvo: um toque planeja naquele dia e refeição, sem porções, e linka a semana', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    renderAction(target)
    await user.click(screen.getByRole('button', { name: rotulo }))
    expect(await screen.findByRole('link', { name: M.verCardapio })).toHaveAttribute(
      'href',
      '/me/meal-plan?semana=2026-10-05',
    )
    expect(calls).toEqual([
      { url: '/api/me/meal-plan/entries', method: 'POST', body: { recipeId: 'r-nova', day: '2026-10-06', slot: 'jantar' } },
    ])
  })

  it('com alvo: dia cheio mostra o erro e mantém o botão', async () => {
    const user = userEvent.setup()
    mockFetch(409, { error: 'dia_cheio' })
    renderAction(target)
    await user.click(screen.getByRole('button', { name: rotulo }))
    expect(await screen.findByRole('alert')).toHaveTextContent(M.erroDiaCheio)
    expect(screen.getByRole('button', { name: rotulo })).toBeEnabled()
  })

  it('com alvo: o rótulo traz a data, e o foco vai para "Ver cardápio" depois do toque', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderAction(target)
    expect(screen.getByRole('button', { name: rotulo })).toHaveTextContent('06/10')
    await user.click(screen.getByRole('button', { name: rotulo }))
    await waitFor(() => expect(screen.getByRole('link', { name: M.verCardapio })).toHaveFocus())
  })

  it('outra Receita depois de planejar ("criar outra") volta a oferecer o botão', async () => {
    const user = userEvent.setup()
    mockFetch()
    const view = renderAction(target)
    await user.click(screen.getByRole('button', { name: rotulo }))
    await screen.findByRole('link', { name: M.verCardapio })
    view.rerender(tree(target, 'r-outra'))
    expect(screen.getByRole('button', { name: rotulo })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: M.verCardapio })).not.toBeInTheDocument()
  })

  it('alvo de uma semana que já passou vale como sem alvo: abre o painel, nada de um toque', async () => {
    const user = userEvent.setup()
    const calls = mockFetch()
    renderAction({ day: '2026-09-22', slot: 'jantar' })
    expect(screen.queryByRole('button', { name: /22\/09/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: M.porNoCardapio }))
    expect(await screen.findByRole('button', { name: M.planejar })).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('sem alvo: abre o painel de dia + refeição', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderAction(null)
    await user.click(screen.getByRole('button', { name: M.porNoCardapio }))
    await waitFor(() => expect(screen.getByRole('button', { name: M.planejar })).toBeInTheDocument())
  })
})
