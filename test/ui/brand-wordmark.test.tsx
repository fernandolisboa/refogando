import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { BrandWordmark } from '@/components/brand-wordmark'

/**
 * Wordmark "steam-R" (#270). Garante o contrato que a revisão adversarial do plano exigiu:
 * - nome acessível REAL (aria-label literal, não só o fallback do jsdom pro <text>);
 * - os DOIS fios de vapor carregam o token `stroke-brand` (o da frente é fácil de escapar do grupo);
 * - o 'R'/palavra continua TEXTO de verdade no DOM (SEO/crawler);
 * - `decorative` (rodapé) sai da árvore de a11y (sem 2º role=img), mas mantém o texto no DOM.
 */
describe('BrandWordmark — wordmark "steam-R" (#270)', () => {
  it('expõe role=img com nome acessível e aria-label LITERAL "Refogando"', () => {
    render(<BrandWordmark name="Refogando" />)
    const img = screen.getByRole('img', { name: 'Refogando' })
    // Asserção do ATRIBUTO (não só do nome computado): leitores reais não caem no <text>.
    expect(img).toHaveAttribute('aria-label', 'Refogando')
    expect(img.tagName.toLowerCase()).toBe('svg')
  })

  it('renderiza a palavra como <text> de verdade (real, p/ crawler)', () => {
    const { container } = render(<BrandWordmark name="Refogando" />)
    const text = container.querySelector('text')
    expect(text).not.toBeNull()
    expect(text).toHaveTextContent('Refogando')
  })

  it('os DOIS fios de vapor carregam stroke-brand (frente E trás)', () => {
    const { container } = render(<BrandWordmark name="Refogando" />)
    const paths = container.querySelectorAll('path')
    expect(paths).toHaveLength(2)
    // toHaveClass lê getAttribute('class') → seguro em SVG (className é SVGAnimatedString).
    paths.forEach((p) => expect(p).toHaveClass('stroke-brand'))
  })

  it('nunca emite aria-label vazio: name falsy cai em "Refogando"', () => {
    render(<BrandWordmark name="" />)
    expect(screen.getByRole('img', { name: 'Refogando' })).toHaveAttribute(
      'aria-label',
      'Refogando',
    )
  })

  it('decorative: sai da árvore de a11y (sem role=img), mas mantém o texto no DOM', () => {
    const { container } = render(<BrandWordmark name="Refogando" decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    const svg = container.querySelector('svg')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('aria-label')
    // texto segue no DOM (SEO), só escondido da AT.
    expect(container.querySelector('text')).toHaveTextContent('Refogando')
  })
})
