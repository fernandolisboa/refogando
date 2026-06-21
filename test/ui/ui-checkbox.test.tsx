import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'

import { Checkbox } from '@/components/ui/checkbox'

/**
 * Seam de FRONTEND (ADR-0018) — primitiva Checkbox do shadcn/ui pintada com a skin Refogando.
 * Sem browser/Postgres: prova a a11y de referência do Radix (role="checkbox", aria-checked,
 * estado disabled, foco/teclado/clique alternando) e a aplicação da skin via data-state.
 */
describe('ui/Checkbox — primitiva shadcn pintada de Refogando', () => {
  it('renderiza com role=checkbox e desmarcada por padrão (aria-checked=false)', () => {
    render(<Checkbox aria-label="Aceito" />)
    const box = screen.getByRole('checkbox', { name: 'Aceito' })
    expect(box).toBeInTheDocument()
    expect(box).toHaveAttribute('aria-checked', 'false')
    expect(box).toHaveAttribute('data-slot', 'checkbox')
    // Estado desmarcado: NÃO recebe a páprica de checked.
    expect(box).toHaveAttribute('data-state', 'unchecked')
  })

  it('defaultChecked: começa marcada (aria-checked=true, data-state=checked) e mostra o check', () => {
    render(<Checkbox defaultChecked aria-label="Lembrar" />)
    const box = screen.getByRole('checkbox', { name: 'Lembrar' })
    expect(box).toHaveAttribute('aria-checked', 'true')
    expect(box).toHaveAttribute('data-state', 'checked')
  })

  it('clique alterna o estado (uncontrolled): unchecked → checked → unchecked', async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Notificar" />)
    const box = screen.getByRole('checkbox', { name: 'Notificar' })

    expect(box).toHaveAttribute('aria-checked', 'false')
    await user.click(box)
    expect(box).toHaveAttribute('aria-checked', 'true')
    await user.click(box)
    expect(box).toHaveAttribute('aria-checked', 'false')
  })

  it('teclado: Space alterna o estado (a11y de referência do Radix)', async () => {
    const user = userEvent.setup()
    render(<Checkbox aria-label="Espaço" />)
    const box = screen.getByRole('checkbox', { name: 'Espaço' })

    box.focus()
    expect(box).toHaveFocus()
    await user.keyboard(' ')
    expect(box).toHaveAttribute('aria-checked', 'true')
  })

  it('onCheckedChange dispara com o novo valor ao clicar', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Callback" onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('checkbox', { name: 'Callback' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('controlado: reflete a prop checked e não muda sozinho sem o handler', async () => {
    function Controlled() {
      const [checked, setChecked] = useState(false)
      return (
        <>
          <Checkbox aria-label="Controlado" checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
          <span data-testid="estado">{checked ? 'on' : 'off'}</span>
        </>
      )
    }
    const user = userEvent.setup()
    render(<Controlled />)
    expect(screen.getByTestId('estado')).toHaveTextContent('off')
    await user.click(screen.getByRole('checkbox', { name: 'Controlado' }))
    expect(screen.getByTestId('estado')).toHaveTextContent('on')
    expect(screen.getByRole('checkbox', { name: 'Controlado' })).toHaveAttribute('aria-checked', 'true')
  })

  it('disabled: aria-disabled e não alterna ao clicar', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox aria-label="Desabilitada" disabled onCheckedChange={onCheckedChange} />)
    const box = screen.getByRole('checkbox', { name: 'Desabilitada' })

    expect(box).toBeDisabled()
    await user.click(box)
    expect(onCheckedChange).not.toHaveBeenCalled()
    expect(box).toHaveAttribute('aria-checked', 'false')
    expect(box.className).toContain('disabled:opacity-50')
  })

  it('className de call-site faz merge com o default (cn/tailwind-merge)', () => {
    render(<Checkbox aria-label="Extra" className="rounded-full" />)
    const box = screen.getByRole('checkbox', { name: 'Extra' })
    // O override do call-site entra; o vocabulário da skin (size-4, border-input) permanece.
    expect(box.className).toContain('rounded-full')
    expect(box.className).toContain('size-4')
    expect(box.className).toContain('border-input')
  })
})
