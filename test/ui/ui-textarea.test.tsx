import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { Textarea } from '@/components/ui/textarea'

/**
 * Seam de FRONTEND (ADR-0018) — prova, sem browser/Postgres, a primitiva Textarea:
 * render como <textarea> acessível, props nativas repassadas (placeholder/value/disabled),
 * o data-slot da convenção shadcn, a skin de campo (min-h-16 + field-sizing-content, e os
 * tokens quentes da #54, NUNCA bg-muted/bg-accent), e o override de className via cn().
 */
describe('Textarea (ui, ADR-0018)', () => {
  it('renderiza um <textarea> acessível e repassa props nativas (placeholder)', () => {
    render(<Textarea placeholder="Escreva sua receita" />)
    const el = screen.getByPlaceholderText('Escreva sua receita')
    expect(el).toBeInTheDocument()
    expect(el.tagName).toBe('TEXTAREA')
  })

  it('expõe o data-slot da convenção shadcn', () => {
    render(<Textarea placeholder="x" />)
    expect(screen.getByPlaceholderText('x')).toHaveAttribute('data-slot', 'textarea')
  })

  it('carrega a skin de campo: min-h-16 + field-sizing-content + tokens quentes (sem slate/muted/accent nus)', () => {
    render(<Textarea placeholder="skin" />)
    const el = screen.getByPlaceholderText('skin')
    // Altura mínima maior que Input + auto-crescimento por conteúdo.
    expect(el).toHaveClass('min-h-16', 'field-sizing-content')
    // Skin Refogando: superfície/borda/texto via token quente.
    expect(el).toHaveClass('bg-card', 'border-input', 'text-foreground')
    expect(el.className).toContain('placeholder:text-muted-foreground')
    // Os nomes reservados NUNCA aparecem nus (muted=texto, accent=selo de erva).
    expect(el.className).not.toMatch(/(^|\s)bg-muted(\s|$)/)
    expect(el.className).not.toMatch(/(^|\s)bg-accent(\s|$)/)
  })

  it('aceita digitação e reflete o valor (controle nativo)', async () => {
    const user = userEvent.setup()
    render(<Textarea aria-label="campo" />)
    const el = screen.getByRole('textbox', { name: 'campo' })
    await user.type(el, 'refogado')
    expect(el).toHaveValue('refogado')
  })

  it('respeita disabled (sem foco/digitação)', () => {
    render(<Textarea aria-label="off" disabled />)
    const el = screen.getByRole('textbox', { name: 'off' })
    expect(el).toBeDisabled()
    expect(el).toHaveClass('disabled:cursor-not-allowed', 'disabled:opacity-50')
  })

  it('faz merge do className do call-site sem brigar com o default (cn/tw-merge)', () => {
    render(<Textarea aria-label="merge" className="min-h-32 bg-secondary" />)
    const el = screen.getByRole('textbox', { name: 'merge' })
    // O override do call-site vence os conflitantes...
    expect(el).toHaveClass('min-h-32', 'bg-secondary')
    expect(el).not.toHaveClass('min-h-16', 'bg-card')
    // ...mas o restante do default segue intacto.
    expect(el).toHaveClass('field-sizing-content', 'rounded-md')
  })
})
