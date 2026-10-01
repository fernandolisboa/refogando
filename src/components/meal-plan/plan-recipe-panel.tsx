'use client'

/**
 * Peças de "planejar uma Receita" (ADR-0035 dec.4, ADR-0040), compartilhadas pelo detalhe, pela Despensa
 * e pelo resultado da criação:
 * - `usePlanMealEntry`: o POST de uma Refeição planejada + o mapeamento de erro (uma fonte só);
 * - `PlannedNotice`: "Adicionada ao cardápio: terça-feira, jantar. Ver cardápio";
 * - `PlanRecipePanel`: escolhe o dia (os próximos 7, a partir de HOJE no fuso do navegador — dec.2) e a
 *   refeição, e planeja com um toque. Quem o abre decide as porções: o detalhe manda o valor do
 *   escalador; a Despensa e a criação mandam `null` (porções da própria Receita);
 * - `PlanRecipePopoverButton`: o botão que abre o painel num Popover.
 */
import { forwardRef, useState } from 'react'
import Link from 'next/link'
import { CalendarPlus } from 'lucide-react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MEAL_SLOTS, addDays, weekStartOf, type MealSlot } from '@/domain/meal-plan'
import { cn } from '@/lib/utils'
import {
  capitalizeFirst,
  formatShortDay,
  formatWeekday,
  localTodayIso,
  mealPlanErrorMessage,
  mealSlotLabel,
  slotForNow,
} from './meal-plan-format'

/** POST de uma Refeição planejada. `true` = planejada; em falha, `error` traz a mensagem localizada. */
export function usePlanMealEntry(recipeId: string) {
  const { messages } = useLocale()
  const m = messages.cardapio
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(day: string, slot: MealSlot, porcoes: number | null = null): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/me/meal-plan/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId, day, slot, ...(porcoes != null ? { porcoes } : {}) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(mealPlanErrorMessage(body.error, m))
        return false
      }
      return true
    } catch {
      setError(m.erroSalvar)
      return false
    } finally {
      setBusy(false)
    }
  }

  return { submit, busy, error }
}

/** "Adicionada ao cardápio: {dia}, {refeição}." + o link para a semana. Vai DENTRO de uma região viva. */
export const PlannedNotice = forwardRef<HTMLAnchorElement, { day: string; slot: MealSlot }>(function PlannedNotice(
  { day, slot },
  linkRef,
) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  return (
    <>
      {m.planejadaEm
        .replace('{dia}', () => formatWeekday(day, locale))
        .replace('{refeicao}', () => mealSlotLabel(slot, m).toLowerCase())}{' '}
      <Link
        ref={linkRef}
        href={`/me/meal-plan?semana=${weekStartOf(day)}`}
        className="font-medium text-brand-ink underline-offset-4 hover:underline"
      >
        {m.verCardapio}
      </Link>
    </>
  )
})

/** Botão (com ícone de calendário) que abre `PlanRecipePanel` num Popover, nas porções da Receita. */
export function PlanRecipePopoverButton({
  recipeId,
  ariaLabel,
  size,
}: {
  recipeId: string
  ariaLabel?: string
  size?: 'sm' | 'default'
}) {
  const { messages } = useLocale()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="secondary" size={size} aria-label={ariaLabel}>
          <CalendarPlus aria-hidden />
          {messages.cardapio.porNoCardapio}
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <PlanRecipePanel recipeId={recipeId} porcoes={null} />
      </PopoverContent>
    </Popover>
  )
}

export function PlanRecipePanel({ recipeId, porcoes }: { recipeId: string; porcoes: number | null }) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const [today] = useState(() => localTodayIso())
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const [day, setDay] = useState(today)
  const [slot, setSlot] = useState<MealSlot>(() => slotForNow())
  const { submit: plan, busy, error } = usePlanMealEntry(recipeId)
  const [done, setDone] = useState<{ day: string; slot: MealSlot } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setDone(null)
    if (await plan(day, slot, porcoes)) setDone({ day, slot })
  }

  const dayLabel = (d: string, i: number) => (i === 0 ? m.hoje : capitalizeFirst(formatShortDay(d, locale)))

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="font-display text-sm font-semibold text-fg">{m.planejarReceita}</p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs font-medium text-muted">{m.dia}</legend>
        <div className="flex flex-wrap gap-1.5">
          {days.map((d, i) => (
            <button
              key={d}
              type="button"
              aria-pressed={day === d}
              onClick={() => {
                setDay(d)
                setDone(null)
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors',
                day === d
                  ? 'border-brand bg-brand/10 font-medium text-brand-ink'
                  : 'border-border text-fg hover:border-brand-ink',
              )}
            >
              {dayLabel(d, i)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {m.refeicao}
        <select
          value={slot}
          onChange={(e) => {
            setSlot(e.target.value as MealSlot)
            setDone(null)
          }}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-fg shadow-sm"
        >
          {MEAL_SLOTS.map((s) => (
            <option key={s} value={s}>
              {mealSlotLabel(s, m)}
            </option>
          ))}
        </select>
      </label>
      {porcoes != null && (
        <p className="text-xs text-muted">
          {porcoes === 1 ? m.porcaoValor : m.porcoesValor.replace('{n}', String(porcoes))}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? m.planejando : m.planejar}
      </Button>
      {error != null && (
        <p role="alert" className="text-sm font-medium text-fg">
          {error}
        </p>
      )}
      {/* Região viva SEMPRE no DOM: leitores de tela ignoram uma região inserida junto do texto. */}
      <p role="status" aria-live="polite" className="text-sm text-fg empty:hidden">
        {done != null && <PlannedNotice day={done.day} slot={done.slot} />}
      </p>
    </form>
  )
}
