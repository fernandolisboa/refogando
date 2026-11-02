import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '@/server/deps'
import { rateLimitWindow, searchQueryEmbedding, rateLimit } from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import { GLOBAL_LIMIT_KEY, RATE_LIMITS, windowStartOf } from '@/domain/rate-limit-rules'
import {
  consumeRateLimit,
  consumeRateLimits,
  deleteExpiredRateLimitWindows,
  derivedSubkey,
  limiterKey,
  releaseRateLimit,
} from '@/server/rate-limit/window'
import { SEARCH_QUERY_EMBEDDING_TTL_MS, searchQueryCacheKey } from '@/server/search/query-embedding'
import { EMBEDDING_VERSION } from '@/server/embedding/embedder'
import { RETENTION_STEPS } from '@/server/legal/data-retention'
import { GET as rateLimitCleanupGET } from '@/app/api/cron/rate-limit-cleanup/route'

/**
 * Limitador persistido do app (#643, #648, ADR-0057) contra o Postgres descartável: atomicidade sob concorrência
 * (`Promise.all`), virada de janela, ordem das regras, chave HMAC (nunca o IP em claro) e a limpeza (de hora em hora e
 * na retenção diária) das janelas encerradas e dos vetores de busca vencidos.
 */

// Meio de uma janela de 10 min (e de 1 min), para a virada ficar explícita nos testes.
const NOW = new Date('2026-11-02T12:05:30.000Z')
const MIN = 60_000

async function windows() {
  return getDb().select().from(rateLimitWindow)
}

describe('consumeRateLimit — janela fixa com upsert atômico', () => {
  it('N pedidos simultâneos (Promise.all) ⇒ passam EXATAMENTE `limite`, e a linha para no limite', async () => {
    const rule = { bucket: 'takedown_global' as const, key: GLOBAL_LIMIT_KEY, limit: 5, windowMs: 10 * MIN }
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeRateLimit(getDb(), rule, NOW)))
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
    const rows = await windows()
    expect(rows).toHaveLength(1)
    expect(rows[0].count).toBe(5) // o bloqueado não soma
    expect(rows[0].windowStart.getTime()).toBe(windowStartOf(NOW.getTime(), 10 * MIN))
    expect(rows[0].expiresAt.getTime()).toBe(windowStartOf(NOW.getTime(), 10 * MIN) + 10 * MIN)
  })

  it('bloqueado devolve o bucket e o tempo até a virada; na janela seguinte volta a passar', async () => {
    const rule = { bucket: 'takedown_ip' as const, key: limiterKey('takedown_ip', '203.0.113.7'), limit: 2, windowMs: 10 * MIN }
    expect((await consumeRateLimit(getDb(), rule, NOW)).allowed).toBe(true)
    expect((await consumeRateLimit(getDb(), rule, NOW)).allowed).toBe(true)
    const blocked = await consumeRateLimit(getDb(), rule, NOW)
    expect(blocked).toEqual({ allowed: false, bucket: 'takedown_ip', retryAfterMs: 4 * MIN + 30_000 })

    // Ainda na mesma janela (1 ms antes da virada): bloqueado.
    const end = windowStartOf(NOW.getTime(), 10 * MIN) + 10 * MIN
    expect((await consumeRateLimit(getDb(), rule, new Date(end - 1))).allowed).toBe(false)
    // Virou: janela nova, linha nova, contador do zero.
    expect((await consumeRateLimit(getDb(), rule, new Date(end))).allowed).toBe(true)
    expect((await consumeRateLimit(getDb(), rule, new Date(end + 1000))).allowed).toBe(true)
    expect((await consumeRateLimit(getDb(), rule, new Date(end + 2000))).allowed).toBe(false)
    const rows = (await windows()).sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime())
    expect(rows.map((r) => r.count)).toEqual([2, 2])
  })

  it('a concorrência na virada não mistura janelas: cada uma conta o seu limite', async () => {
    const rule = { bucket: 'dpo_email_arrival' as const, key: GLOBAL_LIMIT_KEY, limit: 3, windowMs: MIN }
    const start = windowStartOf(NOW.getTime(), MIN)
    const instants = [start + MIN - 5, start + MIN + 5] // um pouco antes e um pouco depois da virada
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => consumeRateLimit(getDb(), rule, new Date(instants[i % 2]))),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(6) // 3 em cada janela
  })

  it('limite 0 bloqueia sem tocar o banco', async () => {
    const d = await consumeRateLimit(getDb(), { bucket: 'dpo_email_arrival', key: GLOBAL_LIMIT_KEY, limit: 0 }, NOW)
    expect(d.allowed).toBe(false)
    expect(await windows()).toHaveLength(0)
  })

  it('usa os tetos de `RATE_LIMITS` por padrão', async () => {
    const { limit } = RATE_LIMITS.takedown_ip
    const rule = { bucket: 'takedown_ip' as const, key: limiterKey('takedown_ip', '198.51.100.1') }
    for (let i = 0; i < limit; i++) expect((await consumeRateLimit(getDb(), rule, NOW)).allowed).toBe(true)
    expect((await consumeRateLimit(getDb(), rule, NOW)).allowed).toBe(false)
  })
})

describe('consumeRateLimits — ordem das regras', () => {
  it('para no primeiro bloqueio: quem passou do próprio limite não gasta o teto global', async () => {
    const ip = { bucket: 'search_embed_ip' as const, key: limiterKey('search_embed_ip', '192.0.2.1'), limit: 1 }
    const global = { bucket: 'search_embed_global_anon' as const, key: GLOBAL_LIMIT_KEY, limit: 100 }
    expect((await consumeRateLimits(getDb(), [ip, global], NOW)).allowed).toBe(true)
    for (let i = 0; i < 5; i++) {
      const d = await consumeRateLimits(getDb(), [ip, global], NOW)
      expect(d.allowed).toBe(false)
      if (!d.allowed) expect(d.bucket).toBe('search_embed_ip')
    }
    const rows = await windows()
    expect(rows.find((r) => r.bucket === 'search_embed_global_anon')?.count).toBe(1)
  })

  it('o teto global barra mesmo com IPs todos diferentes', async () => {
    const global = { bucket: 'search_embed_global_anon' as const, key: GLOBAL_LIMIT_KEY, limit: 3 }
    const allowed: boolean[] = []
    for (let i = 0; i < 6; i++) {
      const ip = { bucket: 'search_embed_ip' as const, key: limiterKey('search_embed_ip', `10.0.0.${i}`), limit: 5 }
      allowed.push((await consumeRateLimits(getDb(), [ip, global], NOW)).allowed)
    }
    expect(allowed).toEqual([true, true, true, false, false, false])
  })

  it('o global barrou ⇒ a unidade da regra anterior (IP) é devolvida: o pedido que não saiu não gasta a cota própria', async () => {
    const ip = { bucket: 'search_embed_ip' as const, key: limiterKey('search_embed_ip', '192.0.2.50'), limit: 5 }
    const global = { bucket: 'search_embed_global_anon' as const, key: GLOBAL_LIMIT_KEY, limit: 1 }
    expect((await consumeRateLimits(getDb(), [ip, global], NOW)).allowed).toBe(true)
    for (let i = 0; i < 4; i++) {
      const d = await consumeRateLimits(getDb(), [ip, global], NOW)
      expect(d.allowed).toBe(false)
      if (!d.allowed) expect(d.bucket).toBe('search_embed_global_anon')
    }
    const rows = await windows()
    expect(rows.find((r) => r.bucket === 'search_embed_ip')?.count).toBe(1) // só o que passou
    expect(rows.find((r) => r.bucket === 'search_embed_global_anon')?.count).toBe(1)
  })

  it('releaseRateLimit não desce de 0 nem cria linha', async () => {
    const rule = { bucket: 'takedown_ip' as const, key: limiterKey('takedown_ip', '192.0.2.60') }
    await releaseRateLimit(getDb(), rule, NOW)
    expect(await windows()).toHaveLength(0)
    await consumeRateLimit(getDb(), rule, NOW)
    await releaseRateLimit(getDb(), rule, NOW)
    await releaseRateLimit(getDb(), rule, NOW)
    expect((await windows())[0].count).toBe(0)
  })
})

describe('limiterKey — o IP nunca vai em claro', () => {
  it('HMAC estável, por escopo, sem o IP no texto', async () => {
    const a = limiterKey('takedown_ip', '203.0.113.9')
    expect(a).toBe(limiterKey('takedown_ip', '203.0.113.9'))
    expect(a).not.toBe(limiterKey('search_embed_ip', '203.0.113.9'))
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/)
    await consumeRateLimit(getDb(), { bucket: 'takedown_ip', key: a }, NOW)
    expect(JSON.stringify(await windows())).not.toContain('203.0.113.9')
  })

  it('subchaves HKDF por rótulo: 32 bytes, estáveis, diferentes entre si', () => {
    const rl = derivedSubkey('refogando/rate-limit')
    const sq = derivedSubkey('refogando/search-query')
    expect(rl).toHaveLength(32)
    expect(rl.equals(derivedSubkey('refogando/rate-limit'))).toBe(true)
    expect(rl.equals(sq)).toBe(false)
  })
})

describe('limpeza das janelas e dos vetores de busca', () => {
  async function seedVector(key: string, createdAt: Date) {
    await getDb()
      .insert(searchQueryEmbedding)
      .values({ queryKey: key, embedding: Array<number>(EMBEDDING_DIMENSIONS).fill(0.5), model: EMBEDDING_VERSION, createdAt })
  }

  it('deleteExpiredRateLimitWindows: só as encerradas saem, em lotes', async () => {
    const rule = (k: string) => ({ bucket: 'takedown_ip' as const, key: k, windowMs: 10 * MIN })
    await consumeRateLimit(getDb(), rule('velha-1'), new Date(NOW.getTime() - 30 * MIN))
    await consumeRateLimit(getDb(), rule('velha-2'), new Date(NOW.getTime() - 20 * MIN))
    await consumeRateLimit(getDb(), rule('atual'), NOW)
    expect(await deleteExpiredRateLimitWindows(getDb(), NOW, 1)).toBe(1)
    expect(await deleteExpiredRateLimitWindows(getDb(), NOW, 10)).toBe(1)
    expect(await deleteExpiredRateLimitWindows(getDb(), NOW, 10)).toBe(0)
    expect((await windows()).map((r) => r.key)).toEqual(['atual'])
  })

  it('retenção diária: os passos `rateLimitWindows` e `searchQueryEmbeddings` apagam o vencido e mantêm o resto', async () => {
    await consumeRateLimit(getDb(), { bucket: 'dpo_email_arrival', key: GLOBAL_LIMIT_KEY }, new Date(NOW.getTime() - 3 * 60 * MIN))
    await consumeRateLimit(getDb(), { bucket: 'dpo_email_arrival', key: GLOBAL_LIMIT_KEY }, NOW)
    await seedVector('vencido', new Date(NOW.getTime() - SEARCH_QUERY_EMBEDDING_TTL_MS - 1000))
    await seedVector('valido', new Date(NOW.getTime() - SEARCH_QUERY_EMBEDDING_TTL_MS + 1000))

    const step = (key: string) => RETENTION_STEPS.find((s) => s.key === key)!
    expect(await step('rateLimitWindows').run(getDb(), NOW)).toBe(1)
    expect(await step('searchQueryEmbeddings').run(getDb(), NOW)).toBe(1)
    expect(await windows()).toHaveLength(1)
    const left = await getDb().select({ k: searchQueryEmbedding.queryKey }).from(searchQueryEmbedding)
    expect(left.map((r) => r.k)).toEqual(['valido'])
  })

  describe('GET /api/cron/rate-limit-cleanup (de hora em hora)', () => {
    const original = process.env.CRON_SECRET
    beforeEach(() => {
      process.env.CRON_SECRET = 'segredo-de-teste'
      // A rota usa `new Date()`: relógio congelado no meio das janelas, para a janela "atual" não virar no meio do
      // teste. Só o `Date` (o postgres-js usa `setTimeout` de verdade).
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(NOW)
    })
    afterEach(() => {
      vi.useRealTimers()
      if (original === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = original
    })

    it('apaga também as janelas encerradas e os vetores vencidos, e devolve só contagens', async () => {
      const now = Date.now()
      await consumeRateLimit(getDb(), { bucket: 'takedown_ip', key: limiterKey('takedown_ip', '1.2.3.4') }, new Date(now - 2 * 60 * MIN))
      await consumeRateLimit(getDb(), { bucket: 'takedown_ip', key: limiterKey('takedown_ip', '1.2.3.5') }, new Date(now))
      await seedVector(searchQueryCacheKey('frango velho'), new Date(now - SEARCH_QUERY_EMBEDDING_TTL_MS - MIN))
      await getDb().insert(rateLimit).values({ key: 'x', count: 1, lastRequest: now - 3 * 60 * MIN })

      const res = await rateLimitCleanupGET(
        new Request('http://localhost/api/cron/rate-limit-cleanup', { headers: { authorization: 'Bearer segredo-de-teste' } }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ deleted: 1, windows: 1, searchVectors: 1 })
      expect(await windows()).toHaveLength(1)
    })
  })
})
