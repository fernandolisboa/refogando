import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do CHIP de status de Visibilidade (#195/ADR-0021 decisão 4). Componente PURO que
 * substitui o controle inline de Visibilidade no detalhe só-leitura: NÃO-clicável (sem botão/link),
 * só reflete Privada/Pública. A AÇÃO de publicar migrou pro toggle rascunho do modal de edição.
 */

import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { RecipeStatusChip } from '@/components/recipe/recipe-status-chip'

afterEach(() => cleanup())

describe('RecipeStatusChip (#195)', () => {
  it('privada: mostra "Privada" e NÃO é clicável (sem botão/link)', () => {
    const { container } = render(<RecipeStatusChip visibility="private" m={ptBR} />)
    expect(screen.getByText(ptBR.visibilidade.privadaBadge)).toBeInTheDocument()
    // Chip não-clicável: nada de botão nem link.
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })

  it('pública: mostra "Pública"', () => {
    render(<RecipeStatusChip visibility="public" m={ptBR} />)
    expect(screen.getByText(ptBR.visibilidade.publicaBadge)).toBeInTheDocument()
  })

  it('en-US: "Private"', () => {
    render(<RecipeStatusChip visibility="private" m={enUS} />)
    expect(screen.getByText(enUS.visibilidade.privadaBadge)).toBeInTheDocument()
  })
})
