'use client'

/**
 * Toggle de ordenação Relevância ↔ Popularidade da Comunidade (#62). Componente CONTROLADO
 * e PURO — sem `fetch` nem locale próprio: recebe rótulos e callback do pai (análogo a
 * como `FacetFieldset` recebe estado/callback de `SearchExperience`).
 *
 * Par de botões num `role="group"`: ativo `btnPrimarySm`, inativo `btnSecondarySm` (ambos
 * `px-3.5 py-1.5` ⇒ padding idêntico, sem SALTO de layout ao alternar a seleção). Só
 * tokens neutros/brand já AA-verificados; NUNCA accent (Catálogo) nem âmbar (Aviso) —
 * Popularidade é eixo de descoberta, não de confiança (ADR-0015).
 */
import { btnPrimarySm, btnSecondarySm } from '@/components/button'

type SortOption = 'relevancia' | 'popularidade'

export function SortToggle({
  value,
  onChange,
  relevanciaLabel,
  popularidadeLabel,
  groupLabel,
}: {
  value: SortOption
  onChange: (sort: SortOption) => void
  relevanciaLabel: string
  popularidadeLabel: string
  groupLabel: string
}) {
  const options: ReadonlyArray<{ key: SortOption; label: string }> = [
    { key: 'relevancia', label: relevanciaLabel },
    { key: 'popularidade', label: popularidadeLabel },
  ]

  return (
    <div
      role="group"
      aria-labelledby="sort-toggle-label"
      className="flex flex-wrap items-center gap-2"
    >
      {/* O texto VISÍVEL é a ÚNICA fonte do nome acessível do grupo (via aria-labelledby) —
          sem duplicar a string num aria-label, que o leitor de tela anunciaria duas vezes. */}
      <span id="sort-toggle-label" className="text-sm text-muted">
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
