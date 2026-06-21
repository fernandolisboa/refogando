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
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      {/* Cada opção é um CHIP arredondado (protótipo Checkbox.jsx): tinge de páprica quando
          marcado (bg-brand/10 + borda + tinta de marca). Mantém o Radix Checkbox dentro pela
          a11y e pelo estado; o pill é a casca. Páprica, nunca erva (erva = selo do Catálogo). */}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isChecked = selected.includes(option.value)
          return (
            <Label
              key={option.value}
              className={cn(
                'inline-flex cursor-pointer select-none items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-normal transition-colors duration-150 ease-out',
                isChecked
                  ? 'border-brand bg-brand/10 text-brand-ink'
                  : 'border-border bg-surface text-fg',
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
