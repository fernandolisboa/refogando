'use client'

/**
 * Painel "Adicionar ao cardápio" (ADR-0035 dec.4): escolhe o dia (os próximos 7, a partir de HOJE no
 * fuso do navegador — dec.2) e a refeição, e planeja a Receita com um toque. Mora num Popover; quem o
 * abre decide as porções: o detalhe manda o valor do escalador, a Despensa e o resultado da criação
 * (ADR-0040) mandam `null` (porções da própria Receita).
 */
import { useState } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
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

export function PlanRecipePanel({ recipeId, porcoes }: { recipeId: string; porcoes: number | null }) {
  const { locale, messages } = useLocale()
  const m = messages.cardapio
  const [today] = useState(() => localTodayIso())
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const [day, setDay] = useState(today)
  const [slot, setSlot] = useState<MealSlot>(() => slotForNow())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ day: string; slot: MealSlot } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const res = await fetch('/api/me/meal-plan/entries', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipeId, day, slot, ...(porcoes != null ? { porcoes } : {}) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(mealPlanErrorMessage(body.error, m))
        return
      }
      setDone({ day, slot })
    } catch {
      setError(m.erroSalvar)
    } finally {
      setBusy(false)
    }
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
      {done != null && (
        <p role="status" aria-live="polite" className="text-sm text-fg">
          {m.planejadaEm
            .replace('{dia}', () => formatWeekday(done.day, locale))
            .replace('{refeicao}', () => mealSlotLabel(done.slot, m).toLowerCase())}{' '}
          <Link
            href={`/me/meal-plan?semana=${weekStartOf(done.day)}`}
            className="font-medium text-brand-ink underline-offset-4 hover:underline"
          >
            {m.verCardapio}
          </Link>
        </p>
      )}
    </form>
  )
}
