'use client'

import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { IngredientView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'
import { formatIngredientLine, scaleIngredient } from '@/domain/ingredient-line'

const MIN_PORCOES = 1
const MAX_PORCOES = 99

/**
 * Escalador de porções (#452) — controle "porções − N +" que re-renderiza a LISTA de ingredientes
 * multiplicando `quantidade` pelo fator `porcoes-corrente / porcoes-original` (CONTEXT.md:192:
 * "`quantidade` × `ratio` permite escalar por porções sem IA"). Puro client-side, zero schema, zero
 * IA, zero custo: `scaleIngredient` faz a aritmética; `formatIngredientLine` (PR#370, ADR-0012
 * Adendo 2) segue sendo a ÚNICA fonte de prosa — não reimplementamos flexão de unidade/número aqui.
 *
 * Item SEM quantidade estruturada fica como está (`scaleIngredient` é no-op nesse caso) — o texto
 * nunca é a fonte da medida, então não há o que escalar.
 *
 * Renderiza a MESMA estrutura (heading "Ingredientes" + `<ul role="list">`) que `RecipeDetailView`
 * usava antes — troca de lugar, não de forma, então os testes/A11y de heading/lista continuam
 * válidos. Só existe quando `originalPorcoes` é conhecido (a página só monta este componente
 * quando `view.porcoes != null`); sem porções originais não há razão pra escalar.
 */
export function RecipePortionScaler({
  ingredients,
  originalPorcoes,
  m,
  locale,
}: {
  ingredients: readonly IngredientView[]
  originalPorcoes: number
  m: Messages
  locale: string
}) {
  const [porcoes, setPorcoes] = useState(originalPorcoes)
  const factor = porcoes / originalPorcoes

  const lines = [...ingredients]
    .sort((a, b) => a.ordem - b.ordem)
    .map((item) => ({
      ordem: item.ordem,
      text: formatIngredientLine(scaleIngredient(item, factor), m, locale),
    }))
    .filter((line) => line.text !== '')

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold text-fg">{m.detalhe.ingredientes}</h2>
        <div className="flex items-center gap-2 text-sm text-fg">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={m.detalhe.porcoesDiminuir}
            disabled={porcoes <= MIN_PORCOES}
            onClick={() => setPorcoes((p) => Math.max(MIN_PORCOES, p - 1))}
          >
            <Minus aria-hidden="true" />
          </Button>
          {/* `aria-live="polite"` anuncia a MUDANÇA sem reler a lista inteira de ingredientes a
              cada clique. `sr-only` prefixa "Porções" no texto lido (leitor de tela senão só
              ecoa o número cru, ex. "8", sem contexto) — o rótulo VISÍVEL continua só o número. */}
          <span aria-live="polite" className="min-w-[3ch] text-center font-medium tabular-nums">
            <span className="sr-only">{m.detalhe.porcoes}: </span>
            {porcoes}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={m.detalhe.porcoesAumentar}
            disabled={porcoes >= MAX_PORCOES}
            onClick={() => setPorcoes((p) => Math.min(MAX_PORCOES, p + 1))}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      <ul role="list" className="flex max-w-[68ch] flex-col gap-1.5 text-fg">
        {lines.map((line) => (
          <li key={line.ordem}>{line.text}</li>
        ))}
      </ul>
    </section>
  )
}
