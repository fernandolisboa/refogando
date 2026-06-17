/**
 * Fieldset genérico de checkboxes para UMA faceta multi-seleção da Busca (#56).
 * Acessível: `<fieldset><legend>` agrupa, cada opção é `<label><input checkbox>`. Sem
 * hooks de fetch — o estado (`selected`) vem do pai e cada toggle volta via `onToggle`.
 * Reusado por Cozinha, Categoria e Restrição (3 instâncias no SearchExperience).
 */
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
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="inline-flex items-center gap-2 text-sm text-fg"
          >
            <input
              type="checkbox"
              className="accent-brand-strong"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
