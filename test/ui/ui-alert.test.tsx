import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'

/**
 * Seam de FRONTEND (ADR-0018), projeto "ui" (jsdom, sem Postgres/provider). A primitiva Alert
 * é pura estrutura + a11y: prova `role="alert"`, os data-slot da convenção shadcn, a skin por
 * token de cada variante (info = superfície neutra; aviso = ÂMBAR, nunca vermelho), o default
 * (info) e o merge de className de override (cn/twMerge). Sem `dark:` a testar — os tokens
 * quentes viram sozinhos via @theme inline.
 */
describe('Alert — primitiva shadcn/ui (ADR-0018)', () => {
  it('renderiza com role="alert", data-slot e a variante default (info) por token', () => {
    render(
      <Alert>
        <AlertTitle>Receita salva</AlertTitle>
        <AlertDescription>Sua receita já está na sua lista.</AlertDescription>
      </Alert>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveAttribute('data-slot', 'alert')
    // Default = info: superfície de massa, NUNCA bg-muted/bg-accent nus.
    expect(alert).toHaveClass('bg-surface', 'border-border', 'text-foreground')
    expect(alert).not.toHaveClass('bg-aviso-bg')
  })

  it('título e descrição renderizam com seus data-slot e ficam em col-start-2', () => {
    render(
      <Alert>
        <AlertTitle>Atenção</AlertTitle>
        <AlertDescription>Detalhe do aviso.</AlertDescription>
      </Alert>,
    )

    const title = screen.getByText('Atenção')
    expect(title).toHaveAttribute('data-slot', 'alert-title')
    expect(title).toHaveClass('col-start-2', 'font-medium')

    const desc = screen.getByText('Detalhe do aviso.')
    expect(desc).toHaveAttribute('data-slot', 'alert-description')
    expect(desc).toHaveClass('col-start-2', 'text-muted-foreground')
  })

  it('variante "aviso" pinta o ÂMBAR de restrição (token aviso, nunca vermelho)', () => {
    render(
      <Alert variant="aviso">
        <AlertTitle>Contém glúten</AlertTitle>
      </Alert>,
    )

    const alert = screen.getByRole('alert')
    // Âmbar declarado-não-verificado (#7/#57): bg/texto de aviso + borda âmbar com opacidade.
    expect(alert).toHaveClass('bg-aviso-bg', 'text-aviso-fg', 'border-aviso-fg/30')
    expect(alert).not.toHaveClass('bg-surface')
    // Sem token destructive/vermelho — o aviso é âmbar, toque leve.
    expect(alert).not.toHaveClass('bg-destructive')
  })

  it('className de call-site sobrescreve o default da base via cn()/twMerge', () => {
    render(
      <Alert className="bg-secondary">
        <AlertTitle>Override</AlertTitle>
      </Alert>,
    )

    const alert = screen.getByRole('alert')
    // twMerge desempata: o override de fundo vence, o bg-surface da base sai.
    expect(alert).toHaveClass('bg-secondary')
    expect(alert).not.toHaveClass('bg-surface')
  })

  it('repassa props arbitrárias (ex.: aria-label) ao container do alerta', () => {
    render(
      <Alert aria-label="Aviso de restrição">
        <AlertTitle>X</AlertTitle>
      </Alert>,
    )
    expect(screen.getByRole('alert')).toHaveAttribute('aria-label', 'Aviso de restrição')
  })
})
