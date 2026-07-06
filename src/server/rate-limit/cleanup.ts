import { lt } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { rateLimit } from '@/db/schema'

/**
 * Limpeza da tabela `rate_limit` (#449, hardening pós-merge) — o Better Auth PERSISTE um contador por
 * chave (`storage:'database'`) mas NUNCA o expurga: cada IP/rota vira uma linha permanente, então a tabela
 * cresce de forma ilimitada com o tempo (e cada chave de IP forjável do abuso, antes do fix da fonte de IP,
 * inchava ainda mais). Uma linha só é SIGNIFICATIVA dentro da sua janela; passada a janela, o Better Auth
 * a trata como zerada de qualquer forma. Este módulo apaga as linhas cuja última requisição é MAIS ANTIGA
 * que a maior janela configurada (com folga), limitando o crescimento sem afetar nenhum contador ativo.
 *
 * PURO no sentido de I/O: recebe `db` + `now` (injetáveis), sem ler relógio/ambiente por conta própria.
 */

/**
 * Idade máxima de uma linha de `rate_limit` antes de ser expurgável. A maior janela configurada nos
 * `customRules`/default do Better Auth é 60s; 1h é uma folga ampla que garante que NUNCA apagamos um
 * contador ainda dentro da sua janela (mesmo com skew de relógio), mantendo a tabela enxuta. `lastRequest`
 * é epoch ms (bigint mode:'number'), então a comparação é em milissegundos.
 */
export const RATE_LIMIT_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Apaga as linhas de `rate_limit` cuja `lastRequest` (epoch ms) é anterior a `now - RATE_LIMIT_MAX_AGE_MS`.
 * Devolve quantas foram removidas (metadado não-sensível para o corpo do cron). Idempotente.
 */
export async function cleanupRateLimit(
  db: Database,
  now: Date = new Date(),
): Promise<{ deleted: number }> {
  const cutoffMs = now.getTime() - RATE_LIMIT_MAX_AGE_MS
  const removed = await db
    .delete(rateLimit)
    .where(lt(rateLimit.lastRequest, cutoffMs))
    .returning({ id: rateLimit.id })
  return { deleted: removed.length }
}
