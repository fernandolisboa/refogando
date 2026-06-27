/**
 * Fieldset genérico de checkboxes para UMA faceta multi-seleção da Busca (#56).
 * Acessível: `<fieldset><legend>` agrupa, cada opção é `<label><input checkbox>`. Sem
 * hooks de fetch — o estado (`selected`) vem do pai e cada toggle volta via `onToggle`.
 * Reusado por Cozinha, Categoria e Restrição (3 instâncias no SearchExperience).
 */
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type FacetOption = { value: string; label: string }

export function FacetFieldset({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string
  options: FacetOption[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-fg">{legend}</legend>
      {/* #5 (Direção C): LISTA VERTICAL de linhas de checkbox na trilha de filtros (era chip-pílula).
          Cada opção é uma linha `quadradinho marcável + rótulo`, empilhada — o desenho da trilha de
          188px. O Radix Checkbox é o controle (a11y/estado); marcado fica páprica (token de marca),
          nunca erva (erva = selo do Catálogo). Texto da linha em tinta normal pra leitura calma. */}
      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const isChecked = selected.includes(option.value)
          return (
            <Label
              key={option.value}
              className={cn(
                'inline-flex cursor-pointer select-none items-center gap-2.5 text-sm font-normal text-fg transition-colors duration-150 ease-out',
                isChecked && 'text-brand-ink',
              )}
            >
              <Checkbox checked={isChecked} onCheckedChange={() => onToggle(option.value)} />
              {option.label}
            </Label>
          )
        })}
      </div>
    </fieldset>
  )
}
