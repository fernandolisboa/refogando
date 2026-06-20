import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link → <a> simples (sem AppRouterContext no jsdom). Espelha recipes-feed.test.tsx.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { RecipeResultItem, type BadgeLabels } from '@/components/recipe/recipe-result-item'

const badgeLabels: BadgeLabels = { catalogo: 'Catálogo', comunidade: 'Comunidade' }

function renderItem(over: { imageUrl?: string } = {}) {
  return render(
    <RecipeResultItem
      recipeId="r-1"
      displayedTitle="Bolo de cenoura"
      origin="catalog"
      autoTranslationSignal={false}
      badgeLabels={badgeLabels}
      autoTranslationLabel="Tradução automática"
      {...over}
    />,
  )
}

describe('RecipeResultItem — thumbnail (#130)', () => {
  it('com imageUrl: renderiza a thumbnail (alt = título)', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    renderItem({ imageUrl: url })
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe(url)
    expect(img).toHaveAttribute('alt', 'Bolo de cenoura')
  })

  it('sem imageUrl: estado limpo (nenhuma <img>)', () => {
    renderItem()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
