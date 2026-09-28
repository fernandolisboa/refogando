/**
 * Utilidades de CLIENTE do Plano de refeições (ADR-0035): o dia de HOJE no fuso de quem usa (o
 * servidor nunca deriva o dia — dec.2), rótulos das refeições do dia e datas por extenso via `Intl`.
 * Sem React; testável direto.
 */
import { planDateToUtc, type MealSlot } from '@/domain/meal-plan'
import type { Messages } from '@/i18n/messages'

/** `YYYY-MM-DD` de hoje no fuso LOCAL do navegador (não UTC — "hoje" é o dia de quem planeja). */
export function localTodayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Refeição sugerida pela hora local: até 10h café, até 15h almoço, até 18h lanche, senão jantar. */
export function slotForNow(now: Date = new Date()): MealSlot {
  const h = now.getHours()
  if (h < 10) return 'cafe_da_manha'
  if (h < 15) return 'almoco'
  if (h < 18) return 'lanche'
  return 'jantar'
}

/** Código de erro das rotas do Plano → mensagem localizada (fonte única pros três chamadores). */
export function mealPlanErrorMessage(code: string | undefined, m: Messages['cardapio']): string {
  switch (code) {
    case 'dia_cheio':
      return m.erroDiaCheio
    case 'ja_planejada':
      return m.erroJaPlanejada
    default:
      return m.erroSalvar
  }
}

/** Rótulo localizado de uma refeição do dia. */
export function mealSlotLabel(slot: MealSlot, m: Messages['cardapio']): string {
  switch (slot) {
    case 'cafe_da_manha':
      return m.slotCafeDaManha
    case 'almoco':
      return m.slotAlmoco
    case 'lanche':
      return m.slotLanche
    case 'jantar':
      return m.slotJantar
  }
}

// Formata como data de calendário em UTC (`timeZone: 'UTC'`): o `YYYY-MM-DD` já É o dia; UTC evita
// que o fuso do navegador desloque meia-noite pro dia anterior.
const asUtcDate = planDateToUtc

/** Primeira letra maiúscula, o resto intacto ("segunda-feira" → "Segunda-feira"; CSS `capitalize` faria "Segunda-Feira"). */
export function capitalizeFirst(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1)
}

/** "segunda-feira" / "Monday". */
export function formatWeekday(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(asUtcDate(iso))
}

/** "seg., 29/09" / "Mon, 9/29" — rótulo curto pra seletores. */
export function formatShortDay(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    timeZone: 'UTC',
  }).format(asUtcDate(iso))
}

/** "seg." / "Mon" — rótulo mínimo, pra opções de mover. */
export function formatWeekdayShort(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(asUtcDate(iso))
}

/** "29 de set." / "Sep 29". */
export function formatDayMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    asUtcDate(iso),
  )
}

/** "29/09" / "9/29" — curto, pro nome padrão da lista gerada. */
/** "28/09/2026" / "09/28/2026" — COM ano: nome sugerido da lista da semana (não colide com o do ano que vem). */
export function formatNumericDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(asUtcDate(iso))
}

export function formatNumericDayMonth(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
    asUtcDate(iso),
  )
}
