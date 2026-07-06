import { describe, it, expect } from 'vitest'
import { getDb } from '@/server/deps'
import { rateLimit } from '@/db/schema'
import { cleanupRateLimit, RATE_LIMIT_MAX_AGE_MS } from '@/server/rate-limit/cleanup'

/**
 * Limpeza da tabela `rate_limit` (#449, hardening pós-merge) contra o Postgres descartável. Prova: linhas
 * mais antigas que a idade máxima são removidas; as ainda dentro da janela (recentes) FICAM; devolve a
 * contagem correta; idempotente (2ª passada não remove mais nada).
 */

const NOW = new Date('2026-07-05T12:00:00.000Z')

/** Semeia uma linha de rate_limit com `lastRequest` = NOW - ageMs. */
async function seedRow(key: string, ageMs: number): Promise<void> {
  await getDb()
    .insert(rateLimit)
    .values({ key, count: 1, lastRequest: NOW.getTime() - ageMs })
}

async function keysLeft(): Promise<string[]> {
  const rows = await getDb().select({ key: rateLimit.key }).from(rateLimit)
  return rows.map((r) => r.key).sort()
}

describe('cleanupRateLimit (#449)', () => {
  it('remove linhas passadas da idade máxima e MANTÉM as recentes', async () => {
    await seedRow('stale-1', RATE_LIMIT_MAX_AGE_MS + 60_000) // bem antiga ⇒ removível
    await seedRow('stale-2', RATE_LIMIT_MAX_AGE_MS + 1) // 1ms além do limiar ⇒ removível
    await seedRow('fresh-1', RATE_LIMIT_MAX_AGE_MS - 60_000) // dentro da janela ⇒ fica
    await seedRow('fresh-2', 0) // agora mesmo ⇒ fica

    const { deleted } = await cleanupRateLimit(getDb(), NOW)
    expect(deleted).toBe(2)
    expect(await keysLeft()).toEqual(['fresh-1', 'fresh-2'])
  })

  it('idempotente: 2ª passada não remove nada', async () => {
    await seedRow('stale', RATE_LIMIT_MAX_AGE_MS + 1)
    await seedRow('fresh', 0)

    expect((await cleanupRateLimit(getDb(), NOW)).deleted).toBe(1)
    expect((await cleanupRateLimit(getDb(), NOW)).deleted).toBe(0)
    expect(await keysLeft()).toEqual(['fresh'])
  })
})
