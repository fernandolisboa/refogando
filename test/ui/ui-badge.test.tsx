import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Badge, badgeVariants } from '@/components/ui/badge'

/**
 * Seam de teste de FRONTEND (jsdom, ADR-0018) para a primitiva Badge. Prova, sem
 * browser/Postgres: render de um <span> com o `data-slot` da convenção; cada variante pinta a
 * classe de token quente certa (selos de proveniência — skin Refogando, não o slate do
 * shadcn); a invariante de ADR-0015 (erva SÓ em `catalog`; SEM variante âmbar — âmbar é
 * exclusivo do Alert de restrição; nunca `bg-accent`/`bg-muted` nus); `asChild` delega ao filho.
 */
describe('Badge (ui/badge, ADR-0018)', () => {
  it('renderiza um <span> com o default-slot e a variante padrão (neutra)', () => {
    render(<Badge>Comunidade</Badge>)
    const badge = screen.getByText('Comunidade')
    expect(badge).toBeInTheDocument()
    expect(badge.tagName).toBe('SPAN')
    expect(badge).toHaveAttribute('data-slot', 'badge')
    // defaultVariants: variant=default (neutro — Comunidade / ai_*).
    expect(badge).toHaveClass('border-border', 'bg-surface', 'text-muted-foreground')
  })

  it.each([
    ['default', 'text-muted-foreground'],
    ['catalog', 'bg-accent-surface'],
    ['mine', 'text-brand-ink'],
    ['translation', 'italic'],
  ] as const)('aplica a classe-marca da variante %s', (variant, expected) => {
    render(<Badge variant={variant}>x</Badge>)
    expect(screen.getByText('x')).toHaveClass(expected)
  })

  it('catalog é a ÚNICA variante com a erva (bg-accent-surface text-accent-strong, invariante ADR-0015)', () => {
    render(<Badge variant="catalog">Catálogo</Badge>)
    const badge = screen.getByText('Catálogo')
    expect(badge).toHaveClass('bg-accent-surface', 'text-accent-strong')
  })

  it('mine usa borda de páprica + texto de marca (sua receita), sem cor nova', () => {
    render(<Badge variant="mine">Sua receita</Badge>)
    const badge = screen.getByText('Sua receita')
    // Paridade com o selo de domínio (provenance-badge "minha"): superfície de massa,
    // borda de páprica, texto de marca — distinto do verde do Catálogo e do neutro.
    expect(badge).toHaveClass('border-brand', 'bg-surface', 'text-brand-ink')
  })

  // Nota (ADR-0015): NÃO há variante âmbar/aviso no Badge — âmbar é exclusivo do Alert de
  // restrição. O invariante é garantido pelo tipo (VariantProps não inclui 'aviso'); um
  // `variant="aviso"` num call-site falha no typecheck.

  it.each(['default', 'catalog', 'mine', 'translation'] as const)(
    'a variante %s NUNCA usa bg-accent/bg-muted nus (erva = selo do Catálogo; muted = texto)',
    (variant) => {
      render(<Badge variant={variant}>x</Badge>)
      // Tokeniza: a colisão proibida é a CLASSE nua `bg-accent`/`bg-muted` — o selo
      // do Catálogo USA `bg-accent-surface` (erva) de propósito, que não é nua.
      const tokens = screen.getByText('x').className.split(/\s+/)
      expect(tokens).not.toContain('bg-accent')
      expect(tokens).not.toContain('bg-muted')
    },
  )

  it('asChild delega a estrutura ao filho (vira <a>) preservando href e data-slot', () => {
    render(
      <Badge asChild variant="mine">
        <a href="/receitas/1">Sua receita</a>
      </Badge>,
    )
    const link = screen.getByRole('link', { name: 'Sua receita' })
    expect(link).toHaveAttribute('href', '/receitas/1')
    expect(link).toHaveAttribute('data-slot', 'badge')
    expect(link).toHaveClass('text-brand-ink')
  })

  it('repassa props nativas do <span> (title, aria-label)', () => {
    render(
      <Badge title="tooltip" aria-label="selo">
        x
      </Badge>,
    )
    const badge = screen.getByText('x')
    expect(badge).toHaveAttribute('title', 'tooltip')
    expect(badge).toHaveAttribute('aria-label', 'selo')
  })

  it('o helper badgeVariants é exportado e compõe className extra (twMerge desempata)', () => {
    const cls = badgeVariants({ variant: 'catalog', className: 'ml-2' })
    expect(cls).toContain('bg-accent-surface')
    expect(cls).toContain('ml-2')
  })
})
