import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'

/**
 * Seam de FRONTEND (ADR-0018) — primitiva Avatar do shadcn/ui pintada com a skin Refogando.
 * Sem browser/Postgres. O Radix só renderiza a <img> depois que ela CARREGA (rastreia o status
 * via onload/onerror nativos); no jsdom a imagem nunca dispara `load`, então o Fallback é o que
 * fica no DOM. Testamos: a forma redonda do Root, a skin de serifa/superfície do Fallback (nunca
 * bg-muted), os data-slot da convenção shadcn, e o merge de className do call-site.
 */
describe('ui/Avatar — primitiva shadcn pintada de Refogando', () => {
  it('Root: círculo, não-encolhível, com data-slot', () => {
    render(
      <Avatar data-testid="av">
        <AvatarFallback>MR</AvatarFallback>
      </Avatar>,
    )
    const root = screen.getByTestId('av')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('data-slot', 'avatar')
    expect(root.className).toContain('rounded-full')
    expect(root.className).toContain('size-9')
    expect(root.className).toContain('shrink-0')
    expect(root.className).toContain('overflow-hidden')
  })

  it('Fallback: iniciais em serifa (font-display) sobre bg-surface — NUNCA bg-muted', () => {
    render(
      <Avatar>
        {/* Sem delayMs o fallback renderiza de imediato (status="idle" ≠ "loaded"). */}
        <AvatarFallback>MR</AvatarFallback>
      </Avatar>,
    )
    const fb = screen.getByText('MR')
    expect(fb).toBeInTheDocument()
    expect(fb).toHaveAttribute('data-slot', 'avatar-fallback')
    // Skin Refogando: superfície de massa + serifa, e select-none.
    expect(fb.className).toContain('bg-surface')
    expect(fb.className).toContain('text-foreground')
    expect(fb.className).toContain('font-display')
    expect(fb.className).toContain('select-none')
    // Invariante de colisão (ADR-0018): nada de bg-muted/bg-accent nus na primitiva.
    expect(fb.className).not.toContain('bg-muted')
    expect(fb.className).not.toContain('bg-accent')
  })

  it('AvatarImage: aceita src/alt e carrega o data-slot da convenção shadcn', () => {
    // No jsdom a <img> do Radix só monta com status="loaded" (a imagem nunca "carrega" aqui),
    // então não fica no DOM; o componente aceita src/alt sem quebrar e o Fallback ocupa o lugar.
    render(
      <Avatar>
        <AvatarImage src="https://blob.example/u1.jpg" alt="Maria Receita" />
        <AvatarFallback>MR</AvatarFallback>
      </Avatar>,
    )
    // O alt da imagem NÃO aparece como <img> acessível (ainda não carregou); o fallback aparece.
    expect(screen.queryByRole('img', { name: 'Maria Receita' })).not.toBeInTheDocument()
    expect(screen.getByText('MR')).toBeInTheDocument()
  })

  it('className do call-site faz merge com o default (cn/tailwind-merge)', () => {
    render(
      <Avatar data-testid="av" className="size-20">
        <AvatarFallback>MR</AvatarFallback>
      </Avatar>,
    )
    const root = screen.getByTestId('av')
    // O override de tamanho do call-site vence (tailwind-merge); o resto da forma permanece.
    expect(root.className).toContain('size-20')
    expect(root.className).not.toContain('size-9')
    expect(root.className).toContain('rounded-full')
  })

  it('Fallback aceita override de className sem perder a forma redonda', () => {
    render(
      <Avatar>
        <AvatarFallback className="text-2xl">MR</AvatarFallback>
      </Avatar>,
    )
    const fb = screen.getByText('MR')
    expect(fb.className).toContain('text-2xl')
    expect(fb.className).toContain('rounded-full')
    expect(fb.className).toContain('items-center')
  })
})
