import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { Input } from '@/components/ui/input'

/**
 * Seam de teste de FRONTEND (ADR-0015/0018), projeto "ui" (jsdom, sem Postgres). Prova que a
 * primitiva Input renderiza como <input> nativo acessível, carrega o data-slot/base shadcn,
 * encaminha props nativas (type, placeholder, disabled), é controlável por teclado e que um
 * className de call-site sobrescreve o default via cn()/twMerge.
 */
describe('Input — primitiva shadcn/ui (ADR-0018)', () => {
  it('renderiza um <input> com data-slot e a base de classe (tokens quentes)', () => {
    render(<Input placeholder="Sua busca" />)
    const input = screen.getByPlaceholderText('Sua busca')
    expect(input).toBeInTheDocument()
    expect(input.tagName).toBe('INPUT')
    expect(input).toHaveAttribute('data-slot', 'input')
    // Pele Refogando: tokens do alias shadcn, NUNCA bg-muted/bg-accent nus.
    expect(input).toHaveClass('bg-card', 'border-input', 'text-foreground')
    expect(input).toHaveClass('placeholder:text-muted-foreground')
  })

  it('encaminha props nativas: type e disabled', () => {
    render(<Input type="email" disabled aria-label="E-mail" />)
    const input = screen.getByLabelText('E-mail')
    expect(input).toHaveAttribute('type', 'email')
    expect(input).toBeDisabled()
    expect(input).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed')
  })

  it('é digitável (controlável por teclado, a11y básica)', async () => {
    const user = userEvent.setup()
    render(<Input aria-label="Título" />)
    const input = screen.getByLabelText('Título') as HTMLInputElement
    await user.type(input, 'Bolo de cenoura')
    expect(input.value).toBe('Bolo de cenoura')
  })

  it('className de call-site sobrescreve o default da base via cn()/twMerge', () => {
    render(<Input aria-label="Campo" className="bg-secondary" />)
    const input = screen.getByLabelText('Campo')
    // twMerge desempata: o override de fundo vence, o bg-card da base sai.
    expect(input).toHaveClass('bg-secondary')
    expect(input).not.toHaveClass('bg-card')
  })
})
