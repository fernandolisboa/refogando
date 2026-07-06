import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { webSearchUsageDaily } from '@/db/schema'
import { reserveWebSearchQueries } from '@/server/web-search/usage-counter'
import { DAILY_WEB_SEARCH_QUERY_CAP, utcDayKey } from '@/domain/web-search-budget'

/**
 * Reserva ATÔMICA do teto de gasto diário da descoberta na web (#464) contra o Postgres descartável.
 * Prova: incremento acumula, o teto SEGURA no limite exato, dias distintos são baldes distintos e —
 * o coração — sob concorrência (Promise.all) NÃO passa do teto (sem overshoot de corrida TOCTOU).
 */

const DAY = '2026-07-05'
const NOW = new Date(`${DAY}T12:00:00.000Z`)

async function countFor(day: string): Promise<number | null> {
  const [row] = await getDb()
    .select({ n: webSearchUsageDaily.queryCount })
    .from(webSearchUsageDaily)
    .where(eq(webSearchUsageDaily.day, day))
  return row?.n ?? null
}

/** Semeia a linha do dia com um valor de partida (simula um dia já em andamento). */
async function seedDay(day: string, queryCount: number): Promise<void> {
  await getDb().insert(webSearchUsageDaily).values({ day, queryCount })
}

describe('reserveWebSearchQueries (#464)', () => {
  it('primeira reserva do dia cria a linha e acumula', async () => {
    expect(await reserveWebSearchQueries(getDb(), { count: 3, now: NOW })).toBe(true)
    expect(await countFor(DAY)).toBe(3)
    expect(await reserveWebSearchQueries(getDb(), { count: 5, now: NOW })).toBe(true)
    expect(await countFor(DAY)).toBe(8)
  })

  it('estourar o teto ⇒ false e o contador NÃO avança', async () => {
    await seedDay(DAY, DAILY_WEB_SEARCH_QUERY_CAP - 2)
    // Pede 5, mas só cabem 2 ⇒ recusa por inteiro (reserva tudo-ou-nada), sem avançar o contador.
    expect(await reserveWebSearchQueries(getDb(), { count: 5, now: NOW })).toBe(false)
    expect(await countFor(DAY)).toBe(DAILY_WEB_SEARCH_QUERY_CAP - 2)
  })

  it('reserva EXATAMENTE até o teto é permitida; a próxima é recusada', async () => {
    await seedDay(DAY, DAILY_WEB_SEARCH_QUERY_CAP - 2)
    expect(await reserveWebSearchQueries(getDb(), { count: 2, now: NOW })).toBe(true)
    expect(await countFor(DAY)).toBe(DAILY_WEB_SEARCH_QUERY_CAP)
    expect(await reserveWebSearchQueries(getDb(), { count: 1, now: NOW })).toBe(false)
    expect(await countFor(DAY)).toBe(DAILY_WEB_SEARCH_QUERY_CAP)
  })

  it('dias distintos são baldes independentes (a virada UTC zera o teto)', async () => {
    await seedDay(DAY, DAILY_WEB_SEARCH_QUERY_CAP)
    const nextDay = new Date(`2026-07-06T00:30:00.000Z`)
    expect(await reserveWebSearchQueries(getDb(), { count: 4, now: nextDay })).toBe(true)
    expect(await countFor(utcDayKey(nextDay))).toBe(4)
    // O dia anterior segue cheio, intacto.
    expect(await countFor(DAY)).toBe(DAILY_WEB_SEARCH_QUERY_CAP)
  })

  it('count <= 0 ⇒ no-op reservado sem tocar o banco', async () => {
    expect(await reserveWebSearchQueries(getDb(), { count: 0, now: NOW })).toBe(true)
    expect(await countFor(DAY)).toBeNull()
  })

  it('FRESH-INSERT: count acima do teto do dia é RECUSADO sem criar linha (não pula o cap)', async () => {
    // 1ª reserva do dia (sem linha ainda): o INSERT fresco NÃO passa pelo setWhere do ON CONFLICT, então
    // sem o guard uma reserva > teto criaria a linha estourada. Pedir mais que o teto inteiro ⇒ false, e
    // NENHUMA linha é criada.
    expect(
      await reserveWebSearchQueries(getDb(), { count: DAILY_WEB_SEARCH_QUERY_CAP + 1, now: NOW }),
    ).toBe(false)
    expect(await countFor(DAY)).toBeNull()
  })

  it('CONCORRÊNCIA: N reservas paralelas nunca passam do teto (sem overshoot TOCTOU)', async () => {
    // Faltam 5 slots; 20 chamadas de 1 slot correm em paralelo. Só 5 podem reservar; o contador para
    // EXATAMENTE no teto. Se o incremento não fosse atômico, várias leriam a contagem estale e passariam.
    await seedDay(DAY, DAILY_WEB_SEARCH_QUERY_CAP - 5)
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => reserveWebSearchQueries(getDb(), { count: 1, now: NOW })),
    )
    const granted = outcomes.filter(Boolean).length
    expect(granted).toBe(5)
    expect(await countFor(DAY)).toBe(DAILY_WEB_SEARCH_QUERY_CAP)
  })
})
