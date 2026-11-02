import { createHmac, hkdfSync } from 'node:crypto'
import { and, eq, gt, lte, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { rateLimitWindow } from '@/db/schema'
import { RATE_LIMITS, windowStartOf, type RateLimitBucket } from '@/domain/rate-limit-rules'

/**
 * Limitador PERSISTIDO do app (#643, #648, ADR-0057): contador de janela fixa na tabela `rate_limit_window`,
 * compartilhado por todas as instâncias serverless (o `createIpBurstLimiter`/`createDomainRateLimiter` em memória
 * vale só por instância e zera no cold start).
 *
 * Um statement por regra, sem lock explícito (mesmo desenho do `reserveWebSearchQueries`, #464):
 *
 *   INSERT INTO rate_limit_window (bucket, key, window_start, expires_at, count) VALUES (…, 1)
 *   ON CONFLICT (bucket, key, window_start) DO UPDATE SET count = count + 1 WHERE count < :limite
 *   RETURNING count
 *
 * Janela sem linha ⇒ o INSERT cria com 1 (cabe, `limite ≥ 1`). Com linha ⇒ o lock de linha do ON CONFLICT
 * serializa as concorrentes e cada uma vê o `count` já somado pela anterior: só as que cabem recebem a linha de
 * volta. RETURNING vazio ⇒ bloqueado. O contador nunca passa do limite e o pedido bloqueado não estende a janela.
 *
 * O relógio é o do app (`now` injetável nos testes): a janela é alinhada à época (`windowStartOf`), então
 * instâncias diferentes caem na mesma linha; o desvio de relógio entre elas (NTP, milissegundos) só importa na
 * virada da janela.
 */

export type RateLimitRule = {
  bucket: RateLimitBucket
  /** `limiterKey(...)` (HMAC) ou `GLOBAL_LIMIT_KEY`. Nunca IP ou id em claro. */
  key: string
  /** Default: `RATE_LIMITS[bucket]`. Os testes passam tetos menores. */
  limit?: number
  windowMs?: number
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; bucket: RateLimitBucket; retryAfterMs: number }

/**
 * Segredo-base dos HMAC do app: o do Better Auth. Sem ele, fail-closed fora de teste: um "HMAC" sem chave seria só um
 * hash, e o IPv4 inteiro cabe num dicionário.
 */
function baseSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'test') return 'refogando-test-rate-limit-secret'
  throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
}

const subkeys = new Map<string, Buffer>()

/**
 * Subchave de 32 bytes derivada do segredo do auth por HKDF-SHA256 com um rótulo (`info`) por uso, em vez do segredo
 * cru: cada HMAC do limitador e do cache da busca usa uma chave só dele, e nenhuma delas é a que assina as sessões.
 * Guardada em memória por (segredo, rótulo); trocar o segredo troca a subchave (e zera contadores e cache, aceito).
 * Lança sem segredo fora de teste (ver `baseSecret`).
 */
export function derivedSubkey(info: string): Buffer {
  const secret = baseSecret()
  const id = `${info}\u0000${secret}`
  let key = subkeys.get(id)
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', secret, '', info, 32))
    if (subkeys.size >= 8) subkeys.clear() // poucos rótulos; não acumula entre trocas de segredo nos testes
    subkeys.set(id, key)
  }
  return key
}

/**
 * Chave opaca de um limite: HMAC-SHA256 (subchave HKDF `refogando/rate-limit`) de `rate-limit:<escopo>:<valor>` (22
 * caracteres base64url, 132 bits). O IP chega já reduzido por `ipRateKey` (IPv6 pela /64); a conta, pelo id. O escopo
 * separa os buckets: a chave do mesmo IP na busca e no formulário é outra. Sem a chave (fora do banco), não dá para
 * voltar ao IP nem à conta; com ela, o IPv4 se recupera por força bruta, então a chave nunca vai ao banco nem ao log.
 */
export function limiterKey(scope: string, value: string): string {
  return createHmac('sha256', derivedSubkey('refogando/rate-limit'))
    .update(`rate-limit:${scope}:${value}`)
    .digest('base64url')
    .slice(0, 22)
}

/** Consome UMA unidade da regra na janela atual. Lança só em erro de banco (o chamador decide fail-open/closed). */
export async function consumeRateLimit(db: Database, rule: RateLimitRule, now: Date = new Date()): Promise<RateLimitDecision> {
  const policy = RATE_LIMITS[rule.bucket]
  const limit = Math.trunc(rule.limit ?? policy.limit)
  const windowMs = rule.windowMs ?? policy.windowMs
  const startMs = windowStartOf(now.getTime(), windowMs)
  const endMs = startMs + windowMs
  const retryAfterMs = Math.max(0, endMs - now.getTime())
  if (limit <= 0) return { allowed: false, bucket: rule.bucket, retryAfterMs }

  const rows = await db
    .insert(rateLimitWindow)
    .values({
      bucket: rule.bucket,
      key: rule.key,
      windowStart: new Date(startMs),
      expiresAt: new Date(endMs),
      count: 1,
    })
    .onConflictDoUpdate({
      target: [rateLimitWindow.bucket, rateLimitWindow.key, rateLimitWindow.windowStart],
      set: { count: sql`${rateLimitWindow.count} + 1` },
      // Só soma enquanto cabe: o bloqueado não mexe na linha e o RETURNING vem vazio.
      setWhere: sql`${rateLimitWindow.count} < ${limit}`,
    })
    .returning({ count: rateLimitWindow.count })

  return rows.length > 0 ? { allowed: true } : { allowed: false, bucket: rule.bucket, retryAfterMs }
}

/**
 * Devolve UMA unidade de uma regra que passou na janela de `now` (o par de `consumeRateLimit` com o mesmo `now`).
 * Não desce de 0 nem cria linha. Usado quando uma regra seguinte bloqueia: quem foi barrado pelo teto global não perde
 * a cota própria (IP, conta) por um pedido que não saiu.
 */
export async function releaseRateLimit(db: Database, rule: RateLimitRule, now: Date = new Date()): Promise<void> {
  const windowMs = rule.windowMs ?? RATE_LIMITS[rule.bucket].windowMs
  await db
    .update(rateLimitWindow)
    .set({ count: sql`${rateLimitWindow.count} - 1` })
    .where(
      and(
        eq(rateLimitWindow.bucket, rule.bucket),
        eq(rateLimitWindow.key, rule.key),
        eq(rateLimitWindow.windowStart, new Date(windowStartOf(now.getTime(), windowMs))),
        gt(rateLimitWindow.count, 0),
      ),
    )
}

/**
 * Consome as regras EM ORDEM e para no primeiro bloqueio: as seguintes não são tocadas, e as que já passaram são
 * DEVOLVIDAS (`releaseRateLimit`, best-effort: se a devolução falhar, a unidade fica gasta, como antes). Ponha a mais
 * específica (IP, conta) antes da global, para quem já passou do próprio limite não gastar o teto de todo mundo; a
 * devolução cobre o caso inverso (o global barrou, e o pedido não pode custar a cota própria de ninguém).
 */
export async function consumeRateLimits(
  db: Database,
  rules: readonly RateLimitRule[],
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const passed: RateLimitRule[] = []
  for (const rule of rules) {
    const d = await consumeRateLimit(db, rule, now)
    if (!d.allowed) {
      for (const r of passed) await releaseRateLimit(db, r, now).catch(() => {})
      return d
    }
    passed.push(rule)
  }
  return { allowed: true }
}

/**
 * Apaga UM lote de janelas já encerradas (`expires_at <= now`) e devolve quantas saíram. Uma janela encerrada não
 * conta mais para nada; a chave de IP sai junto. Quem chama repete em lotes (`deleteInBatches`): a limpeza de hora
 * em hora (`/api/cron/rate-limit-cleanup`, que segura as "até 2 horas" da política) e a retenção diária (passo
 * `rateLimitWindows`, rede de segurança se a de hora em hora falhar).
 */
export async function deleteExpiredRateLimitWindows(db: Database, now: Date, limit: number): Promise<number> {
  const removed = await db
    .delete(rateLimitWindow)
    .where(
      sql`ctid IN (SELECT ctid FROM ${rateLimitWindow} WHERE ${lte(rateLimitWindow.expiresAt, now)} LIMIT ${limit})`,
    )
    .returning({ bucket: rateLimitWindow.bucket })
  return removed.length
}
