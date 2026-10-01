import { describe, it, expect, vi, afterEach } from 'vitest'
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
import { formatWeekday } from '@/components/meal-plan/meal-plan-format'
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

function renderAction(target: MealPlanTarget | null) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <MealPlanTargetProvider value={target}>
        <GeneratedRecipePlanAction recipeId="r-nova" />
      </MealPlanTargetProvider>
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GeneratedRecipePlanAction (ADR-0040)', () => {
  const target: MealPlanTarget = { day: '2026-10-06', slot: 'jantar' }
  const dia = formatWeekday(target.day, 'pt-BR')
  const rotulo = M.porNoCardapioAlvo.replace('{dia}', dia).replace('{refeicao}', 'jantar')

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

  it('sem alvo: abre o painel de dia + refeição', async () => {
    const user = userEvent.setup()
    mockFetch()
    renderAction(null)
    await user.click(screen.getByRole('button', { name: M.planejarReceita }))
    await waitFor(() => expect(screen.getByRole('button', { name: M.planejar })).toBeInTheDocument())
  })
})
