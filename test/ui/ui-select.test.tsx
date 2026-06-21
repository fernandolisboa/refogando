import { describe, it, expect, beforeAll } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * Seam de teste de UI (ADR-0015/0018) — prova a primitiva Select acima da seam de servidor,
 * sem browser/Postgres. jsdom não implementa as APIs de ponteiro/scroll que o Radix Select
 * usa ao abrir o listbox; stubá-las (padrão conhecido p/ Radix em jsdom) deixa a abertura via
 * teclado/clique funcionar. Asserções: trigger acessível (role combobox + label), placeholder
 * via token, swap de páprica no item (NUNCA erva), abertura → listbox/options ARIA, e seleção.
 */
beforeAll(() => {
  // Radix Select chama estas no listbox; jsdom não as tem.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
})

function renderSelect(extra?: { triggerClassName?: string }) {
  return render(
    <Select>
      <SelectTrigger aria-label="Tempero" className={extra?.triggerClassName}>
        <SelectValue placeholder="Escolha um tempero" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Ervas</SelectLabel>
          <SelectItem value="manjericao">Manjericão</SelectItem>
          <SelectItem value="alecrim">Alecrim</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="paprica">Páprica</SelectItem>
      </SelectContent>
    </Select>,
  )
}

describe('Select — primitiva shadcn skin Refogando', () => {
  it('renderiza o trigger como combobox acessível, fechado por padrão, com o placeholder', () => {
    renderSelect()
    const trigger = screen.getByRole('combobox', { name: 'Tempero' })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    // Fechado por padrão → nenhum listbox montado.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // Placeholder visível (Radix marca o estado placeholder no trigger).
    expect(trigger).toHaveAttribute('data-placeholder')
    expect(screen.getByText('Escolha um tempero')).toBeInTheDocument()
  })

  it('o trigger usa os tokens warm da casa (bg-card, border-input, placeholder=muted-foreground)', () => {
    renderSelect()
    const trigger = screen.getByRole('combobox', { name: 'Tempero' })
    expect(trigger).toHaveClass('bg-card')
    expect(trigger).toHaveClass('border-input')
    expect(trigger).toHaveClass('text-foreground')
    expect(trigger).toHaveClass('transition-colors')
    // placeholder pinta com o texto secundário café (muted-foreground), não bg-muted.
    expect(trigger.className).toContain('data-[placeholder]:text-muted-foreground')
  })

  it('mescla className de override no trigger via cn() (a última vence)', () => {
    renderSelect({ triggerClassName: 'w-40' })
    const trigger = screen.getByRole('combobox', { name: 'Tempero' })
    expect(trigger).toHaveClass('w-40')
    // base preservada junto do override.
    expect(trigger).toHaveClass('rounded-md')
  })

  it('abre via teclado e expõe o listbox com as opções (role/aria)', async () => {
    const user = userEvent.setup()
    renderSelect()
    const trigger = screen.getByRole('combobox', { name: 'Tempero' })

    trigger.focus()
    await user.keyboard('{Enter}')

    const listbox = await screen.findByRole('listbox')
    expect(listbox).toBeInTheDocument()
    const options = within(listbox).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Manjericão', 'Alecrim', 'Páprica'])
    // O item carrega o swap de páprica (brand/10), NUNCA a erva (accent) reservada ao selo.
    const item = within(listbox).getByRole('option', { name: 'Manjericão' })
    expect(item.className).toContain('data-[highlighted]:bg-brand/10')
    expect(item.className).not.toContain('accent')
  })

  it('seleciona uma opção pelo teclado e reflete o valor no trigger', async () => {
    const user = userEvent.setup()
    renderSelect()
    const trigger = screen.getByRole('combobox', { name: 'Tempero' })

    trigger.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('listbox')
    // Primeira opção fica destacada ao abrir; Enter confirma.
    await user.keyboard('{Enter}')

    // Fechou e o valor selecionado aparece no trigger.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(within(trigger).getByText('Manjericão')).toBeInTheDocument()
  })
})
