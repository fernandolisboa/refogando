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

function renderItem(over: { imageUrl?: string; slug?: string; locale?: string } = {}) {
  const { locale = 'pt-BR', ...rest } = over
  return render(
    <RecipeResultItem
      recipeId="r-1"
      locale={locale}
      displayedTitle="Bolo de cenoura"
      origin="catalog"
      autoTranslationSignal={false}
      badgeLabels={badgeLabels}
      autoTranslationLabel="Tradução automática"
      {...rest}
    />,
  )
}

describe('RecipeResultItem — thumbnail (#130)', () => {
  it('com imageUrl: renderiza a thumbnail (alt = título) com lazy-loading', () => {
    const url = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'
    renderItem({ imageUrl: url })
    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.src).toBe(url)
    expect(img).toHaveAttribute('alt', 'Bolo de cenoura')
    // #462: thumb de feed infinito baixa só ao aproximar da viewport.
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('sem imageUrl: estado limpo (nenhuma <img>)', () => {
    renderItem()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('#132 imageAiGenerated + aiLabel ⇒ mostra o selo "gerada por IA"', () => {
    render(
      <RecipeResultItem
        recipeId="r-2"
        locale="pt-BR"
        displayedTitle="Bolo IA"
        origin="catalog"
        autoTranslationSignal={false}
        badgeLabels={badgeLabels}
        autoTranslationLabel="Tradução automática"
        imageUrl="https://abc.public.blob.vercel-storage.com/recipes/ia.webp"
        imageAiGenerated
        aiLabel="✨ gerada por IA"
      />,
    )
    expect(screen.getByText('✨ gerada por IA')).toBeInTheDocument()
  })

  it('#132 sem imageAiGenerated ⇒ sem selo', () => {
    renderItem({ imageUrl: 'https://abc.public.blob.vercel-storage.com/recipes/foto.webp' })
    expect(screen.queryByText('✨ gerada por IA')).not.toBeInTheDocument()
  })
})

describe('RecipeResultItem — link canônico por slug (#231, ADR-0020)', () => {
  /** O título é o link primário pro detalhe — o <a> que envolve o <h3>. */
  function detailHref() {
    const heading = screen.getByRole('heading', { name: 'Bolo de cenoura' })
    return heading.closest('a')?.getAttribute('href')
  }

  it('com slug ⇒ canônico /{locale}/recipes/<slug> no locale corrente', () => {
    renderItem({ slug: 'bolo-de-cenoura', locale: 'pt-BR' })
    expect(detailHref()).toBe('/pt-BR/recipes/bolo-de-cenoura')
  })

  it('locale en-US ⇒ slug daquele locale no segmento [locale]', () => {
    renderItem({ slug: 'carrot-cake', locale: 'en-US' })
    expect(detailHref()).toBe('/en-US/recipes/carrot-cake')
  })

  it('SEM slug ⇒ fallback canônico por UUID /{locale}/recipes/<uuid> (308a), NUNCA link nu', () => {
    renderItem({ locale: 'pt-BR' }) // recipeId="r-1", sem slug
    const href = detailHref()
    expect(href).toBe('/pt-BR/recipes/r-1')
    // Regressão #231: nunca o link nu sem prefixo de locale.
    expect(href).not.toBe('/recipes/r-1')
  })
})
