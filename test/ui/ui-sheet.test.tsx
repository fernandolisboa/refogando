import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet'

/**
 * Seam de teste de UI (ADR-0015/0018) — prova a primitiva Sheet (drawer, #163) sobre o Radix
 * Dialog, acima da seam de servidor e sem browser. jsdom não mede viewport: testamos o
 * COMPORTAMENTO interativo (abrir/fechar, foco, ESC, clique-fora) e a a11y (role/aria), não o
 * breakpoint em pixel. Os polyfills de ponteiro do Radix vêm do test/ui/setup.ts.
 */

function renderSheet() {
  return render(
    <Sheet>
      <SheetTrigger>Abrir</SheetTrigger>
      <SheetContent closeLabel="Fechar menu">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <a href="#inicio">Início</a>
        <SheetClose>Fechar de dentro</SheetClose>
      </SheetContent>
    </Sheet>,
  )
}

describe('Sheet — primitiva drawer shadcn skin Refogando (#163)', () => {
  it('fica fechado por padrão: nenhum dialog montado, gatilho com aria-expanded=false', () => {
    renderSheet()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: 'Abrir' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('abre ao clicar no gatilho: monta o dialog (role=dialog) com nome acessível e move o foco pra dentro', async () => {
    const user = userEvent.setup()
    renderSheet()
    // Captura o gatilho ANTES de abrir — com o modal aberto, o fundo (e o gatilho) sai da
    // árvore de a11y, então getByRole não o acharia depois.
    const trigger = screen.getByRole('button', { name: 'Abrir' })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // O Dialog do Radix nomeia o painel pelo SheetTitle (aria-labelledby) e liga o gatilho via
    // aria-controls + aria-expanded — o contrato de a11y que a issue pede.
    expect(dialog).toHaveAccessibleName('Menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    // Foco entrou no painel (trap de foco do Radix).
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('o painel usa os tokens da casa (bg-bg, border-border) — sem accent/destructive', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('bg-bg')
    expect(dialog.className).toContain('border-border')
    expect(dialog.className).not.toContain('accent')
    expect(dialog.className).not.toContain('destructive')
  })

  it('ESC fecha o painel', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('o botão X com rótulo acessível fecha o painel', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: 'Fechar menu' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('um SheetClose interno fecha o painel (fecha ao navegar)', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')

    await user.click(screen.getByRole('button', { name: 'Fechar de dentro' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
