/**
 * Countdown legível do teto de uma cota (#132, reusado pelo teto de derivar #588): horas (arredonda p/
 * cima) ou minutos quando < 1h, a partir do `retryAfterMs` do 429. Mesmo texto nos dois locales
 * ("3h"/"20min") — entra no `{tempo}` das mensagens de limite.
 */
export function formatCountdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes >= 60) return `${Math.ceil(minutes / 60)}h`
  return `${minutes}min`
}
