'use client'

/**
 * Segmented control PURO de N opções — controlado, sem `fetch` nem locale próprio: recebe
 * as opções (rótulos já localizados), o valor atual e o callback do pai (análogo a como
 * `FacetFieldset` recebe estado/callback). Usado por: ordenação Relevância ↔ Popularidade
 * da Comunidade (#62) e alternância de modo de criação Estruturado ↔ Prompt aberto (#88).
 *
 * Botões num `role="group"`: ativo `btnPrimarySm`, inativo `btnSecondarySm` (ambos
 * `px-3.5 py-1.5` ⇒ padding idêntico, sem SALTO de layout ao alternar a seleção). Só
 * tokens neutros/brand já AA-verificados; NUNCA accent (Catálogo) nem âmbar (Aviso).
 *
 * `labelId` parametriza o id do rótulo visível (alvo do `aria-labelledby`) para não
 * cristalizar um id duplicado quando dois toggles convivem — cada call-site passa um id
 * único (`'sort-toggle-label'` na busca, `'create-mode-label'` na criação).
 */
import { btnPrimarySm, btnSecondarySm } from '@/components/button'

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
      <div className="flex flex-wrap gap-2">
        {options.map(({ key, label }) => {
          const active = value === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(key)}
              className={active ? btnPrimarySm : btnSecondarySm}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
