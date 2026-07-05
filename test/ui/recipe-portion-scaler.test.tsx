import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { ptBR } from '@/i18n/messages/pt-BR'
import type { IngredientView } from '@/domain/recipe-read'
import { RecipePortionScaler } from '@/components/recipe/recipe-portion-scaler'

/**
 * `RecipePortionScaler` (#452) — escalador de porções client-side. Fixture com 2 ingredientes:
 * um com quantidade estruturada (escala) e um sem (fica como está) — cobre o contrato
 * "itens sem quantidade estruturada ficam como estão" (CONTEXT.md:192).
 */
const M = ptBR

function ingredients(): IngredientView[] {
  return [
    { ordem: 1, quantidade: '2', unidade: 'dente', rawText: 'alho' },
    { ordem: 2, quantidade: null, unidade: 'a_gosto', rawText: 'sal' },
  ]
}

function renderScaler(originalPorcoes = 4) {
  return render(
    <RecipePortionScaler
      ingredients={ingredients()}
      originalPorcoes={originalPorcoes}
      m={M}
      locale="pt-BR"
    />,
  )
}

describe('RecipePortionScaler (#452)', () => {
  it('renderiza o heading "Ingredientes" + a lista na quantidade ORIGINAL', () => {
    renderScaler()
    expect(
      screen.getByRole('heading', { name: M.detalhe.ingredientes, level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('2 dentes de alho')).toBeInTheDocument()
    expect(screen.getByText(`sal ${M.unidadeLabel.a_gosto}`)).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument() // contador de porções = original
  })

  it('"+" dobra o fator e re-renderiza a quantidade escalada; item sem quantidade fica como está', async () => {
    const user = userEvent.setup()
    renderScaler(4)
    const aumentar = screen.getByRole('button', { name: M.detalhe.porcoesAumentar })
    // 4 → 8 porções = fator 2×: "2 dentes de alho" → "4 dentes de alho".
    for (let i = 0; i < 4; i++) await user.click(aumentar)
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('4 dentes de alho')).toBeInTheDocument()
    // Sem quantidade estruturada (a_gosto) ⇒ texto INALTERADO.
    expect(screen.getByText(`sal ${M.unidadeLabel.a_gosto}`)).toBeInTheDocument()
  })

  it('"−" reduz o fator; nunca desce abaixo de 1 porção', async () => {
    const user = userEvent.setup()
    renderScaler(1)
    const diminuir = screen.getByRole('button', { name: M.detalhe.porcoesDiminuir })
    expect(diminuir).toBeDisabled()
    await user.click(diminuir)
    expect(screen.getByText('1')).toBeInTheDocument() // não desceu de 1
  })

  it('meia porção (2 de 4, fator 0.5): "2 dentes de alho" → "1 dente de alho" (unidade flexiona)', async () => {
    const user = userEvent.setup()
    renderScaler(4)
    const diminuir = screen.getByRole('button', { name: M.detalhe.porcoesDiminuir })
    for (let i = 0; i < 2; i++) await user.click(diminuir)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1 dente de alho')).toBeInTheDocument()
  })
})
