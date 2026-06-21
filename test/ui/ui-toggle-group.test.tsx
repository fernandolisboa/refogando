import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/**
 * Seam de FRONTEND (ADR-0018) — primitiva ToggleGroup do shadcn/ui pintada de Refogando.
 * Sem browser/Postgres: prova a a11y de referência do Radix (role="group" + radio/itens,
 * estado selecionado/teclado) e a skin via `data-[state=on]` (ativo páprica, sem salto).
 * É o substituto do par à-mão `sort-toggle.tsx` (ativo btnPrimarySm ↔ inativo btnSecondarySm).
 */
describe('ui/ToggleGroup — primitiva shadcn pintada de Refogando', () => {
  it('renderiza o grupo (radiogroup no single) com os data-slot e os itens', () => {
    render(
      <ToggleGroup type="single" aria-label="Ordenar">
        <ToggleGroupItem value="rel">Relevância</ToggleGroupItem>
        <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
      </ToggleGroup>,
    )
    // No type=single o Radix dá role=radiogroup (itens viram radios); o Root carrega o data-slot.
    const group = screen.getByRole('radiogroup', { name: 'Ordenar' })
    expect(group).toBeInTheDocument()
    expect(group).toHaveAttribute('data-slot', 'toggle-group')

    const rel = screen.getByRole('radio', { name: 'Relevância' })
    const pop = screen.getByRole('radio', { name: 'Popularidade' })
    expect(rel).toHaveAttribute('data-slot', 'toggle-group-item')
    expect(pop).toHaveAttribute('data-slot', 'toggle-group-item')
  })

  it('single + defaultValue: o item selecionado recebe data-state=on (skin de páprica)', () => {
    render(
      <ToggleGroup type="single" defaultValue="rel" aria-label="Ordenar">
        <ToggleGroupItem value="rel">Relevância</ToggleGroupItem>
        <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
      </ToggleGroup>,
    )
    const rel = screen.getByRole('radio', { name: 'Relevância' })
    const pop = screen.getByRole('radio', { name: 'Popularidade' })

    expect(rel).toHaveAttribute('data-state', 'on')
    expect(pop).toHaveAttribute('data-state', 'off')
    // A skin ativa do item: páprica de fundo via data-[state=on], padding idêntico ao inativo.
    expect(rel.className).toContain('data-[state=on]:bg-primary')
    expect(rel.className).toContain('px-3.5')
    expect(pop.className).toContain('px-3.5')
  })

  it('clique alterna a seleção (uncontrolled) — só um ativo por vez no single', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="single" defaultValue="rel" aria-label="Ordenar">
        <ToggleGroupItem value="rel">Relevância</ToggleGroupItem>
        <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
      </ToggleGroup>,
    )
    const rel = screen.getByRole('radio', { name: 'Relevância' })
    const pop = screen.getByRole('radio', { name: 'Popularidade' })

    await user.click(pop)
    expect(pop).toHaveAttribute('data-state', 'on')
    expect(rel).toHaveAttribute('data-state', 'off')
  })

  it('onValueChange dispara com o novo valor ao selecionar', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <ToggleGroup type="single" defaultValue="rel" onValueChange={onValueChange} aria-label="Ordenar">
        <ToggleGroupItem value="rel">Relevância</ToggleGroupItem>
        <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
      </ToggleGroup>,
    )
    await user.click(screen.getByRole('radio', { name: 'Popularidade' }))
    expect(onValueChange).toHaveBeenCalledWith('pop')
  })

  it('controlado: reflete a prop value e não muda sozinho sem o handler', async () => {
    function Controlled() {
      const [value, setValue] = useState('rel')
      return (
        <>
          <ToggleGroup
            type="single"
            value={value}
            onValueChange={(v) => v && setValue(v)}
            aria-label="Ordenar"
          >
            <ToggleGroupItem value="rel">Relevância</ToggleGroupItem>
            <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
          </ToggleGroup>
          <span data-testid="estado">{value}</span>
        </>
      )
    }
    const user = userEvent.setup()
    render(<Controlled />)
    expect(screen.getByTestId('estado')).toHaveTextContent('rel')
    await user.click(screen.getByRole('radio', { name: 'Popularidade' }))
    expect(screen.getByTestId('estado')).toHaveTextContent('pop')
    expect(screen.getByRole('radio', { name: 'Popularidade' })).toHaveAttribute('data-state', 'on')
  })

  it('teclado: setas navegam entre os itens do grupo (a11y de referência do Radix)', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="single" defaultValue="rel" aria-label="Ordenar">
        <ToggleGroupItem value="rel">Relevância</ToggleGroupItem>
        <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
      </ToggleGroup>,
    )
    const rel = screen.getByRole('radio', { name: 'Relevância' })
    rel.focus()
    expect(rel).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Popularidade' })).toHaveFocus()
  })

  it('type=multiple: vários itens podem ficar ativos ao mesmo tempo', async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup type="multiple" aria-label="Filtros">
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    )
    // No multiple os itens são botões com aria-pressed, não radios.
    const a = screen.getByRole('button', { name: 'A' })
    const b = screen.getByRole('button', { name: 'B' })

    await user.click(a)
    await user.click(b)
    expect(a).toHaveAttribute('data-state', 'on')
    expect(b).toHaveAttribute('data-state', 'on')
  })

  it('disabled: o item desabilitado não dispara o callback ao clicar', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <ToggleGroup type="single" onValueChange={onValueChange} aria-label="Ordenar">
        <ToggleGroupItem value="rel" disabled>
          Relevância
        </ToggleGroupItem>
        <ToggleGroupItem value="pop">Popularidade</ToggleGroupItem>
      </ToggleGroup>,
    )
    const rel = screen.getByRole('radio', { name: 'Relevância' })
    expect(rel).toBeDisabled()
    await user.click(rel)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(rel.className).toContain('disabled:opacity-50')
  })

  it('className de call-site faz merge com o default (cn/tailwind-merge)', () => {
    render(
      <ToggleGroup type="single" aria-label="Ordenar" className="w-full">
        <ToggleGroupItem value="rel" className="grow">
          Relevância
        </ToggleGroupItem>
      </ToggleGroup>,
    )
    const group = screen.getByRole('radiogroup', { name: 'Ordenar' })
    expect(group.className).toContain('w-full')
    // O vocabulário da skin permanece no Root e no Item.
    expect(group.className).toContain('inline-flex')
    expect(group.className).toContain('gap-1')
    const rel = screen.getByRole('radio', { name: 'Relevância' })
    expect(rel.className).toContain('grow')
    expect(rel.className).toContain('bg-surface')
    expect(rel.className).toContain('border-border')
  })
})
