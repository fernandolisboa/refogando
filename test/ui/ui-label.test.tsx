import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Label } from '@/components/ui/label'

/**
 * Seam de FRONTEND (ADR-0018) — primitiva `Label` (Radix Label). Sem browser/Postgres/
 * provider: a primitiva é pura estrutura + a11y. Provamos a semântica de <label>: render do
 * conteúdo, o data-slot da convenção shadcn, a associação `htmlFor` ↔ controle, e o merge
 * de className de override (cn/twMerge). Os tokens quentes viram sozinhos no dark, então não
 * há `dark:` a testar aqui — só a estrutura.
 */
describe('Label (ui, ADR-0018)', () => {
  it('renderiza um <label> com o conteúdo, o data-slot e as classes base de skin', () => {
    render(<Label>Nome da receita</Label>)

    const label = screen.getByText('Nome da receita')
    expect(label.tagName).toBe('LABEL')
    expect(label).toHaveAttribute('data-slot', 'label')
    // Skin Refogando via token (sem dark:): texto sólido, peso médio, sem seleção.
    expect(label).toHaveClass('text-foreground', 'text-sm', 'font-medium', 'select-none')
  })

  it('associa-se ao controle via htmlFor (a11y de formulário)', () => {
    render(
      <>
        <Label htmlFor="email">E-mail</Label>
        <input id="email" />
      </>,
    )

    // getByLabelText prova a associação label↔input pelo par htmlFor/id.
    expect(screen.getByLabelText('E-mail')).toBe(screen.getByRole('textbox'))
  })

  it('mescla className de override sem perder as classes base (cn/twMerge)', () => {
    render(<Label className="text-base text-destructive">Aviso</Label>)

    const label = screen.getByText('Aviso')
    // twMerge: o override de tamanho vence o default; o de cor vence text-foreground.
    expect(label).toHaveClass('text-base', 'text-destructive', 'font-medium')
    expect(label).not.toHaveClass('text-sm')
    expect(label).not.toHaveClass('text-foreground')
  })

  it('repassa props arbitrárias (ex.: id) ao <label> subjacente', () => {
    render(<Label id="lbl-x">Porções</Label>)
    expect(screen.getByText('Porções')).toHaveAttribute('id', 'lbl-x')
  })
})
