/**
 * Orçamento de tempo de uma passada de cron, no padrão do backfill de derivados
 * (`src/server/images/derivatives-backfill.ts`): a função da Vercel morre no `maxDuration`, então quem trabalha
 * em unidades (conta, lote, passo) pergunta, ANTES de começar a próxima, se ela ainda cabe. Um orçamento só por
 * passada: a rota cria o seu no começo e passa o MESMO a cada etapa, e o que uma etapa gasta sai do que sobra
 * para as seguintes (`account-purge`, `retention`).
 *
 * `clock` mede o tempo (default `Date.now`; os testes injetam o seu) e `startedAt` é o início da passada (default:
 * o momento da criação).
 */

export type TimeBudget = {
  /** Milissegundos que ainda sobram do orçamento (negativo depois dele). */
  remainingMs(): number
  /** Dá para começar uma unidade nova? Só com pelo menos a reserva sobrando. */
  canStartMore(): boolean
}

export function timeBudget(opts: {
  budgetMs: number
  reserveMs: number
  clock?: () => number
  startedAt?: number
}): TimeBudget {
  const clock = opts.clock ?? Date.now
  const startedAt = opts.startedAt ?? clock()
  const remainingMs = () => opts.budgetMs - (clock() - startedAt)
  return { remainingMs, canStartMore: () => remainingMs() >= opts.reserveMs }
}
