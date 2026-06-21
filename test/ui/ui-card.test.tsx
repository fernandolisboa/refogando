import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'

/**
 * Seam de FRONTEND (ADR-0015/0018), projeto "ui" (jsdom, sem Postgres). `Card` é a primitiva
 * de superfície GENÉRICA — só <div>s estilizados, sem Radix → sem comportamento a testar além
 * da estrutura. Provamos: cada slot renderiza com o data-slot da convenção shadcn e a base de
 * skin (tokens quentes, NUNCA bg-muted/bg-accent nus), a composição header→title/description/
 * content→footer encaixa, e um className de call-site sobrescreve o default via cn()/twMerge.
 */
describe('Card — primitiva shadcn/ui (ADR-0018)', () => {
  it('Card: <div> com data-slot e a base de skin (superfície de massa, tokens quentes)', () => {
    render(<Card data-testid="card">conteúdo</Card>)
    const card = screen.getByTestId('card')
    expect(card.tagName).toBe('DIV')
    expect(card).toHaveAttribute('data-slot', 'card')
    expect(card).toHaveClass(
      'flex',
      'flex-col',
      'gap-4',
      'rounded-lg',
      'border',
      'border-border',
      'bg-card',
      'text-card-foreground',
      'shadow-sm',
    )
  })

  it('CardHeader: data-slot e o layout em coluna com padding superior', () => {
    render(<CardHeader data-testid="h">cabeçalho</CardHeader>)
    const header = screen.getByTestId('h')
    expect(header).toHaveAttribute('data-slot', 'card-header')
    expect(header).toHaveClass('flex', 'flex-col', 'gap-1', 'px-5', 'pt-5')
  })

  it('CardTitle: data-slot e a tipografia editorial serif (font-display)', () => {
    render(<CardTitle>Bolo de cenoura</CardTitle>)
    const title = screen.getByText('Bolo de cenoura')
    expect(title).toHaveAttribute('data-slot', 'card-title')
    // Serif editorial da #54, peso semibold, sem cair em bg-muted/accent.
    expect(title).toHaveClass('font-display', 'text-lg', 'font-semibold', 'leading-tight')
  })

  it('CardDescription: data-slot e o texto secundário café (muted-foreground)', () => {
    render(<CardDescription>Receita rápida de domingo</CardDescription>)
    const desc = screen.getByText('Receita rápida de domingo')
    expect(desc).toHaveAttribute('data-slot', 'card-description')
    // Secundário = muted-foreground (texto café), NUNCA bg-muted (que é reservado).
    expect(desc).toHaveClass('text-sm', 'text-muted-foreground')
  })

  it('CardContent: data-slot e o padding lateral', () => {
    render(<CardContent data-testid="c">corpo</CardContent>)
    const content = screen.getByTestId('c')
    expect(content).toHaveAttribute('data-slot', 'card-content')
    expect(content).toHaveClass('px-5')
  })

  it('CardFooter: data-slot e o eixo de ações alinhado', () => {
    render(<CardFooter data-testid="f">ações</CardFooter>)
    const footer = screen.getByTestId('f')
    expect(footer).toHaveAttribute('data-slot', 'card-footer')
    expect(footer).toHaveClass('flex', 'items-center', 'px-5', 'pb-5')
  })

  it('compõe header→title/description + content + footer numa só superfície', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Pão caseiro</CardTitle>
          <CardDescription>Com fermentação natural</CardDescription>
        </CardHeader>
        <CardContent>Misture os ingredientes…</CardContent>
        <CardFooter>
          <button>Salvar</button>
        </CardFooter>
      </Card>,
    )
    const card = screen.getByTestId('card')
    // Todos os slots vivem dentro da mesma superfície (composição de domínio sem renomear).
    expect(card.querySelector('[data-slot="card-header"]')).toBeInTheDocument()
    expect(screen.getByText('Pão caseiro')).toBeInTheDocument()
    expect(screen.getByText('Com fermentação natural')).toBeInTheDocument()
    expect(screen.getByText('Misture os ingredientes…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('className de call-site sobrescreve o default da base via cn()/twMerge', () => {
    render(
      <Card data-testid="card" className="rounded-none bg-secondary">
        x
      </Card>,
    )
    const card = screen.getByTestId('card')
    // twMerge desempata: o override de raio/fundo vence, o default sai.
    expect(card).toHaveClass('rounded-none', 'bg-secondary')
    expect(card).not.toHaveClass('rounded-lg')
    expect(card).not.toHaveClass('bg-card')
  })
})
