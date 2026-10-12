'use client'

/**
 * "Pôr no cardápio" no resultado da criação (ADR-0040), nos três caminhos (Prompt aberto, Estruturado e
 * Conversa). Com alvo (veio do "Criar receita nova" de uma refeição do Cardápio) é UM toque: planeja a
 * Receita recém-criada naquele dia e refeição. Sem alvo, abre o mesmo painel da Despensa (dia +
 * refeição). Porções: as da Receita, como no seletor do Cardápio. A Receita é do próprio usuário, então
 * passa no gate de Salvar (ADR-0035 dec.4); a brincadeira (`playful`) fica de fora no chamador.
 *
 * Alvo VENCIDO (dia de uma semana que já passou: link antigo, favorito) vale como sem alvo: um toque
 * nunca planeja numa data que a pessoa não está vendo. O rótulo mostra a data, não só o dia da semana.
 */
import { useEffect, useRef, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { weekStartOf, type MealPlanTarget } from '@/domain/meal-plan'
import { formatShortDay, localTodayIso, mealSlotLabel } from './meal-plan-format'
import { useMealPlanTarget } from './meal-plan-target-context'
import { PlanRecipePopoverButton, PlannedNotice, usePlanMealEntry } from './plan-recipe-panel'

export function GeneratedRecipePlanAction({ recipeId }: { recipeId: string }) {
  const target = useMealPlanTarget()
  const [today] = useState(() => localTodayIso())

  if (target != null && target.day >= weekStartOf(today)) {
    // `key`: outra Receita (ex.: "criar outra") recomeça do botão, sem o "planejada" da anterior.
    return <PlanToTarget key={recipeId} recipeId={recipeId} target={target} />
  }
  return <PlanRecipePopoverButton recipeId={recipeId} />
}

function PlanToTarget({ recipeId, target }: { recipeId: string; target: MealPlanTarget }) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const { submit, busy, error } = usePlanMealEntry(recipeId)
  const [done, setDone] = useState(false)
  const linkRef = useRef<HTMLAnchorElement>(null)

  // O botão focado some no sucesso: o foco vai para "Ver cardápio" (senão cairia no <body> do drawer).
  useEffect(() => {
    if (done) linkRef.current?.focus()
  }, [done])

  async function plan() {
    if (await submit(target.day, target.slot)) setDone(true)
  }

  return (
    <>
      {!done && (
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void plan()}>
          <CalendarPlus aria-hidden />
          {busy
            ? m.planejando
            : m.porNoCardapioAlvo
                .replace('{dia}', () => formatShortDay(target.day, locale))
                .replace('{refeicao}', () => mealSlotLabel(target.slot, m).toLowerCase())}
        </Button>
      )}
      {/* Região viva SEMPRE no DOM (leitores de tela ignoram uma região inserida junto do texto). */}
      <p role="status" className={done ? 'text-sm text-fg' : 'sr-only'}>
        {done && <PlannedNotice ref={linkRef} day={target.day} slot={target.slot} />}
      </p>
      {error != null && (
        <p role="alert" className="w-full text-sm font-medium text-fg">
          {error}
        </p>
      )}
    </>
  )
}
