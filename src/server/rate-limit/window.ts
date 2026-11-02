import { createHmac } from 'node:crypto'
import { lte, sql } from 'drizzle-orm'
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
 * Segredo do HMAC das chaves: o do Better Auth, com rótulo próprio na mensagem (`rate-limit:`), como a chave do
 * avatar (`avatar-blob.ts`) e a lápide do cadastro expurgado. Sem segredo, fail-closed fora de teste: um "HMAC" sem
 * chave seria só um hash, e o IPv4 inteiro cabe num dicionário.
 */
function limiterSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === 'test') return 'refogando-test-rate-limit-secret'
  throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
}

/**
 * Chave opaca de um limite: HMAC-SHA256 de `rate-limit:<escopo>:<valor>` (22 caracteres base64url, 132 bits). O
 * IP chega já reduzido por `ipRateKey` (IPv6 pela /64); a conta, pelo id. O escopo separa os buckets: a chave do
 * mesmo IP na busca e no formulário é outra, e nenhuma delas volta ao IP sem o segredo.
 */
export function limiterKey(scope: string, value: string): string {
  return createHmac('sha256', limiterSecret()).update(`rate-limit:${scope}:${value}`).digest('base64url').slice(0, 22)
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
 * Consome as regras EM ORDEM e para no primeiro bloqueio: as seguintes não são tocadas. Ponha a mais específica
 * (IP, conta) antes da global, para quem já passou do próprio limite não gastar o teto de todo mundo. Uma regra que
 * passou antes de outra bloquear fica gasta (aceito: são tetos anti-abuso).
 */
export async function consumeRateLimits(
  db: Database,
  rules: readonly RateLimitRule[],
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  for (const rule of rules) {
    const d = await consumeRateLimit(db, rule, now)
    if (!d.allowed) return d
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
