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

/**
 * Lê a resposta do `POST /api/recipes/[id]/derive` (#588): se for o 429 do teto de Derivar/Clonar
 * (`limite_derivar`), devolve o countdown já formatado pro `{tempo}` de `derivarLimite`; qualquer outra
 * coisa (outro status, outro erro, corpo ilegível) ⇒ `null` e o caller cai na sua mensagem neutra. Usado
 * pelo "Clonar" e pelo "Criar minha versão" (mesmo teto, mesma mensagem). Consome o corpo só no 429.
 */
export async function readDeriveLimit(res: Response): Promise<string | null> {
  if (res.status !== 429) return null
  const b = (await res.json().catch(() => ({}))) as { error?: string; retryAfterMs?: number }
  return b.error === 'limite_derivar' ? formatCountdown(b.retryAfterMs ?? 0) : null
}
