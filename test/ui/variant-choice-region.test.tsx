import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'
import type { VariantChoice } from '@/hooks/use-recipe-generation'

/**
 * Teste de COMPONENTE jsdom da região de ESCOLHA "gerar 2, o usuário escolhe" (#423). Renderiza as 2
 * variações lado a lado (`RecipeDetailView` reusada, nome em h2 — NÃO introduz 2º h1) e um CTA por
 * coluna; picar chama `onEscolher(v)`. `next/link` mockado (RecipeDetailView usa Link).
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { LocaleProvider } from '@/i18n/provider'
import { WithCozinhaVocab } from '../helpers/cozinha-vocab'
import { ptBR } from '@/i18n/messages/pt-BR'
import { VariantChoiceRegion } from '@/components/recipe/variant-choice-region'

const M = ptBR.criar

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

function variant(over: Partial<VariantChoice> = {}): VariantChoice {
  return {
    recipeId: 'r-1',
    slug: 'feijao-tropeiro',
    locale: 'pt-BR',
    label: 'tradicional',
    generationId: 'g-1',
    outcome: 'success',
    advisory: null,
    view: baseView(),
    ...over,
  }
}

function renderRegion(variants: VariantChoice[], onEscolher = vi.fn()) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <WithCozinhaVocab>
        <VariantChoiceRegion variants={variants} messages={ptBR} locale="pt-BR" onEscolher={onEscolher} />
      </WithCozinhaVocab>
    </LocaleProvider>,
  )
  return onEscolher
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VariantChoiceRegion (#423)', () => {
  it('renderiza 2 colunas com as 2 receitas + os rótulos dos pólos', () => {
    renderRegion([
      variant({ generationId: 'g-1', label: 'tradicional', view: baseView({ id: 'r-1', name: 'Feijão à moda antiga' }) }),
      variant({ generationId: 'g-2', label: 'criativa', view: baseView({ id: 'r-2', name: 'Feijão desconstruído' }) }),
    ])
    expect(screen.getByText(M.variacaoTitulo)).toBeInTheDocument()
    // Duas colunas, uma por variação (rotuladas "Versão 1"/"Versão 2").
    expect(screen.getByRole('region', { name: M.variacaoColuna.replace('{n}', '1') })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: M.variacaoColuna.replace('{n}', '2') })).toBeInTheDocument()
    // Os pólos aparecem.
    expect(screen.getByText('tradicional')).toBeInTheDocument()
    expect(screen.getByText('criativa')).toBeInTheDocument()
    // As duas receitas (nome em h2, não h1 — invariante 1-h1 preservada pela região).
    expect(screen.getByRole('heading', { level: 2, name: 'Feijão à moda antiga' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Feijão desconstruído' })).toBeInTheDocument()
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0)
    // Dois CTAs "escolher esta".
    expect(screen.getAllByRole('button', { name: M.variacaoEscolher })).toHaveLength(2)
  })

  it('clicar "escolher esta" chama onEscolher com a variação daquela coluna', async () => {
    const user = userEvent.setup()
    const onEscolher = renderRegion([
      variant({ generationId: 'g-1', label: 'tradicional' }),
      variant({ generationId: 'g-2', label: 'criativa', view: baseView({ id: 'r-2', name: 'Outra' }) }),
    ])
    const col2 = screen.getByRole('region', { name: M.variacaoColuna.replace('{n}', '2') })
    await user.click(within(col2).getByRole('button', { name: M.variacaoEscolher }))
    expect(onEscolher).toHaveBeenCalledTimes(1)
    expect(onEscolher.mock.calls[0][0]).toMatchObject({ generationId: 'g-2', label: 'criativa' })
  })

  it('após o 1º clique, ambos os botões travam (anti-duplicação)', async () => {
    const user = userEvent.setup()
    const onEscolher = renderRegion([variant({ generationId: 'g-1' }), variant({ generationId: 'g-2', view: baseView({ id: 'r-2' }) })])
    const botoes = screen.getAllByRole('button', { name: M.variacaoEscolher })
    await user.click(botoes[0])
    for (const b of screen.getAllByRole('button', { name: M.variacaoEscolher })) {
      expect(b).toBeDisabled()
    }
    // Um 2º clique não dispara outra escolha.
    await user.click(botoes[1])
    expect(onEscolher).toHaveBeenCalledTimes(1)
  })

  it('variação sem corpo (view=null) degrada a coluna mas segue escolhível', async () => {
    const user = userEvent.setup()
    const onEscolher = renderRegion([
      variant({ generationId: 'g-1', view: null }),
      variant({ generationId: 'g-2', view: baseView({ id: 'r-2' }) }),
    ])
    expect(screen.getByText(M.variacaoCorpoIndisponivel)).toBeInTheDocument()
    const col1 = screen.getByRole('region', { name: M.variacaoColuna.replace('{n}', '1') })
    await user.click(within(col1).getByRole('button', { name: M.variacaoEscolher }))
    expect(onEscolher.mock.calls[0][0]).toMatchObject({ generationId: 'g-1' })
  })
})
