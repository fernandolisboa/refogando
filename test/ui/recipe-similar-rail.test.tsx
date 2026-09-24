import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { ptBR } from '@/i18n/messages/pt-BR'
import type { SearchResult } from '@/domain/recipe-search-read'
import { RecipeSimilarRail } from '@/components/recipe/recipe-similar-rail'

const M = ptBR

function result(over: Partial<SearchResult> = {}): SearchResult {
  return {
    recipeId: 'r-1',
    displayedTitle: 'Chili do Texas',
    origin: 'catalog',
    autoTranslationSignal: false,
    isOwn: false,
    ...over,
  }
}

describe('RecipeSimilarRail (#454)', () => {
  it('vazio ⇒ retorna null (AUSENTE, sem heading órfão)', () => {
    const { container } = render(<RecipeSimilarRail results={[]} locale="pt-BR" m={M} />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(M.detalhe.receitasSemelhantes)).toBeNull()
  })

  it('renderiza o heading + um card por resultado (reusa RecipeResultItem)', () => {
    render(
      <RecipeSimilarRail
        results={[
          result({ recipeId: 'r-1', displayedTitle: 'Chili do Texas' }),
          result({ recipeId: 'r-2', displayedTitle: 'Feijoada' }),
        ]}
        locale="pt-BR"
        m={M}
      />,
    )
    expect(
      screen.getByRole('heading', { name: M.detalhe.receitasSemelhantes, level: 2 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Chili do Texas')).toBeInTheDocument()
    expect(screen.getByText('Feijoada')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('selo de proveniência por card: catálogo vs comunidade', () => {
    render(
      <RecipeSimilarRail
        results={[
          result({ recipeId: 'r-1', origin: 'catalog' }),
          result({ recipeId: 'r-2', origin: 'ai_chat', displayedTitle: 'Feijoada da vovó' }),
        ]}
        locale="pt-BR"
        m={M}
      />,
    )
    expect(screen.getByText(M.busca.seloCatalogo)).toBeInTheDocument()
    expect(screen.getByText(M.busca.seloComunidade)).toBeInTheDocument()
  })

  it('link do card usa o slug quando presente; fallback pro recipeId', () => {
    render(
      <RecipeSimilarRail
        results={[result({ recipeId: 'r-1', slug: 'chili-do-texas' })]}
        locale="pt-BR"
        m={M}
      />,
    )
    const link = screen.getByRole('link', { name: /Chili do Texas/ })
    expect(link).toHaveAttribute('href', '/pt-BR/recipes/chili-do-texas')
  })
})
