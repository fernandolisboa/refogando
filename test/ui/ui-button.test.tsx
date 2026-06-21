import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Button, buttonVariants } from '@/components/ui/button'

/**
 * Seam de teste de FRONTEND (jsdom, ADR-0018) para a primitiva Button. Prova, sem
 * browser/Postgres: render como <button> com role acessível; cada variante/size pinta a
 * classe de token quente certa (skin Refogando, não o slate do shadcn); `asChild` delega a
 * estrutura para o filho (Slot.Root) preservando role e props; o `data-slot` da convenção.
 */
describe('Button (ui/button, ADR-0018)', () => {
  it('renderiza um <button> acessível com o default-slot e a variante/size padrão', () => {
    render(<Button>Salvar</Button>)
    const btn = screen.getByRole('button', { name: 'Salvar' })
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAttribute('data-slot', 'button')
    // defaultVariants: variant=default (páprica de fundo), size=default.
    expect(btn).toHaveClass('bg-primary', 'text-primary-foreground', 'h-9')
  })

  it.each([
    ['default', 'bg-primary'],
    ['secondary', 'bg-secondary'],
    ['outline', 'bg-transparent'],
    ['ghost', 'hover:bg-brand/10'],
    ['destructive', 'bg-destructive'],
    ['link', 'text-brand-ink'],
  ] as const)('aplica a classe-marca da variante %s', (variant, expected) => {
    render(<Button variant={variant}>x</Button>)
    expect(screen.getByRole('button')).toHaveClass(expected)
  })

  it.each([
    ['sm', 'h-8'],
    ['default', 'h-9'],
    ['lg', 'h-10'],
    ['icon', 'size-9'],
  ] as const)('aplica a classe de size %s', (size, expected) => {
    render(<Button size={size}>x</Button>)
    expect(screen.getByRole('button')).toHaveClass(expected)
  })

  it('ghost NÃO usa bg-accent (erva reservada ao selo do Catálogo) — usa a lavagem de páprica', () => {
    render(<Button variant="ghost">x</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toHaveClass('hover:bg-brand/10')
    expect(btn.className).not.toMatch(/\bbg-accent\b/)
    expect(btn.className).not.toMatch(/\bbg-muted\b/)
  })

  it('asChild delega a estrutura ao filho (vira <a>) preservando href e data-slot', () => {
    render(
      <Button asChild variant="link">
        <a href="/receitas">Receitas</a>
      </Button>,
    )
    // Sem botão: o Slot.Root fundiu as classes no <a> filho.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Receitas' })
    expect(link).toHaveAttribute('href', '/receitas')
    expect(link).toHaveAttribute('data-slot', 'button')
    expect(link).toHaveClass('text-brand-ink')
  })

  it('repassa props nativas do <button> (disabled, type)', () => {
    render(
      <Button disabled type="submit">
        Enviar
      </Button>,
    )
    const btn = screen.getByRole('button', { name: 'Enviar' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('type', 'submit')
  })

  it('o helper buttonVariants é exportado e compõe className extra (twMerge desempata)', () => {
    const cls = buttonVariants({ variant: 'secondary', size: 'sm', className: 'w-full' })
    expect(cls).toContain('bg-secondary')
    expect(cls).toContain('h-8')
    expect(cls).toContain('w-full')
  })
})
