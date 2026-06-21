'use client'

/**
 * Segmented control PURO de N opções — controlado, sem `fetch` nem locale próprio: recebe
 * as opções (rótulos já localizados), o valor atual e o callback do pai (análogo a como
 * `FacetFieldset` recebe estado/callback). Usado por: ordenação Relevância ↔ Popularidade
 * da Comunidade (#62) e alternância de modo de criação Estruturado ↔ Prompt aberto (#88).
 *
 * Wrapper fino sobre `<ToggleGroup type="single">` (Radix, ADR-0018): o item ativo vira
 * páprica e o inativo parte do secundário, com `px-3.5 py-1.5` em ambos ⇒ padding idêntico,
 * sem SALTO de layout ao alternar a seleção. Só tokens neutros/brand já AA-verificados;
 * NUNCA accent (Catálogo) nem âmbar (Aviso) — tudo herdado da primitiva.
 *
 * CUIDADO de contrato (Radix `type="single"`): a seleção é DESmarcável — clicar no item
 * ativo emite onValueChange(""). Este é um segmented control SEMPRE-selecionado, então
 * descartamos o "" no guard (`if (v) onChange(...)`), preservando a invariante.
 *
 * `labelId` parametriza o id do rótulo visível (alvo do `aria-labelledby`) para não
 * cristalizar um id duplicado quando dois toggles convivem — cada call-site passa um id
 * único (`'sort-toggle-label'` na busca, `'create-mode-label'` na criação).
 */
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function SortToggle<T extends string>({
  value,
  onChange,
  options,
  groupLabel,
  labelId = 'sort-toggle-label',
}: {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ key: T; label: string }>
  groupLabel: string
  labelId?: string
}) {
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
      {/* O texto VISÍVEL é a ÚNICA fonte do nome acessível do grupo (via aria-labelledby) —
          sem duplicar a string num aria-label, que o leitor de tela anunciaria duas vezes. */}
      <span id={labelId} className="text-sm text-muted">
        {groupLabel}
      </span>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v as T)
        }}
        className="flex flex-wrap gap-2"
      >
        {options.map(({ key, label }) => (
          <ToggleGroupItem key={key} value={key}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
