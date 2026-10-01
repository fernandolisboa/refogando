import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import type { RecipeView } from '@/domain/recipe-read'

/**
 * O "Pôr no cardápio" no resultado da criação (ADR-0040): aparece para Receita de verdade (com o alvo
 * do Cardápio, como um toque) e nunca para a brincadeira, que não passa no gate de Salvar.
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
import { GenerationResultRegion } from '@/components/recipe/generation-result-region'
import { MealPlanTargetProvider } from '@/components/meal-plan/meal-plan-target-context'
import type { GenerationResult } from '@/hooks/use-recipe-generation'

const VIEW: RecipeView = {
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
}

function renderRegion(outcome: GenerationResult['outcome']) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <WithCozinhaVocab>
        <MealPlanTargetProvider value={{ day: '2101-01-01', slot: 'almoco' }}>
          <GenerationResultRegion
            result={{ outcome, recipeId: 'r-1', advisory: null }}
            view={VIEW}
            loadFailed={false}
            messages={ptBR}
            locale="pt-BR"
            onRecarregar={() => {}}
            onTentarNovamente={() => {}}
            onCriarOutra={() => {}}
          />
        </MealPlanTargetProvider>
      </WithCozinhaVocab>
    </LocaleProvider>,
  )
}

describe('GenerationResultRegion: pôr no cardápio (ADR-0040)', () => {
  it('Receita gerada com o alvo do Cardápio: botão de um toque', () => {
    renderRegion('success')
    expect(screen.getByRole('button', { name: /^Pôr no cardápio: .*almoço$/ })).toBeInTheDocument()
  })

  it('brincadeira: sem botão de cardápio', () => {
    renderRegion('playful')
    expect(screen.queryByRole('button', { name: /Pôr no cardápio/ })).not.toBeInTheDocument()
  })
})
