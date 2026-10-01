'use client'

/**
 * "Pôr no cardápio" no resultado da criação (ADR-0040). Com alvo (veio do "Criar receita nova" de uma
 * refeição do Cardápio) é UM toque: planeja a Receita recém-criada naquele dia e refeição. Sem alvo, abre
 * o mesmo painel do detalhe (dia + refeição). As porções são as da Receita (`porcoes` ausente), como no
 * seletor do Cardápio. A Receita é do próprio usuário, então passa no gate de Salvar (ADR-0035 dec.4).
 */
import { useState } from 'react'
import Link from 'next/link'
import { CalendarPlus } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { weekStartOf } from '@/domain/meal-plan'
import { formatWeekday, mealPlanErrorMessage, mealSlotLabel } from './meal-plan-format'
import { useMealPlanTarget } from './meal-plan-target-context'
import { PlanRecipePanel } from './plan-recipe-panel'

export function GeneratedRecipePlanAction({ recipeId }: { recipeId: string }) {
  const { messages } = useLocale()
  const m = messages.cardapio
  const target = useMealPlanTarget()
  const [open, setOpen] = useState(false)

  if (target != null) return <PlanToTarget recipeId={recipeId} />

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button type="button" variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <CalendarPlus aria-hidden />
          {m.planejarReceita}
        </Button>
      </PopoverAnchor>
      <PopoverContent>
        <PlanRecipePanel recipeId={recipeId} porcoes={null} />
      </PopoverContent>
    </Popover>
  )
}

function PlanToTarget({ recipeId }: { recipeId: string }) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const target = useMealPlanTarget()!
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A Receita planejada: "criar outra" troca `recipeId`, e o botão volta para a nova.
  const [doneFor, setDoneFor] = useState<string | null>(null)

  const dia = formatWeekday(target.day, locale)
  const refeicao = mealSlotLabel(target.slot, m).toLowerCase()

  async function plan() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/me/meal-plan/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId, day: target.day, slot: target.slot }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(mealPlanErrorMessage(body.error, m))
        return
      }
      setDoneFor(recipeId)
    } catch {
      setError(m.erroSalvar)
    } finally {
      setBusy(false)
    }
  }

  if (doneFor === recipeId) {
    return (
      <p role="status" className="text-sm text-fg">
        {m.planejadaEm.replace('{dia}', () => dia).replace('{refeicao}', () => refeicao)}{' '}
        <Link
          href={`/me/meal-plan?semana=${weekStartOf(target.day)}`}
          className="font-medium text-brand-ink underline-offset-4 hover:underline"
        >
          {m.verCardapio}
        </Link>
      </p>
    )
  }

  return (
    <>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void plan()}>
        <CalendarPlus aria-hidden />
        {busy ? m.planejando : m.porNoCardapioAlvo.replace('{dia}', () => dia).replace('{refeicao}', () => refeicao)}
      </Button>
      {error != null && (
        <p role="alert" className="w-full text-sm font-medium text-fg">
          {error}
        </p>
      )}
    </>
  )
}
