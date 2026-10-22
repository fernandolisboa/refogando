import { getDb } from '@/server/deps'
import { cleanupRateLimit } from '@/server/rate-limit/cleanup'
import { isAuthorizedCron } from '@/server/http/cron-auth'

/**
 * Cron de LIMPEZA da tabela `rate_limit` (#449, hardening pós-merge; ver `vercel.json`). O Better Auth
 * persiste um contador por chave em `storage:'database'` mas nunca o expurga — sem TTL, a tabela cresce sem
 * limite. GET de HORA EM HORA (Vercel Cron) que apaga as linhas passadas da maior janela (via `cleanupRateLimit`),
 * limitando o crescimento sem tocar nenhum contador ainda ativo. De hora em hora (minuto 15) porque a chave é o
 * IP (dado pessoal): com a idade máxima de 50 min, o IP fica no máximo ~2 h depois do último pedido, mesmo com
 * a passada atrasada alguns minutos (ADR-0049, operação 2 do `docs/legal/registro-de-operacoes.md`).
 *
 * FAIL-CLOSED (mesmo padrão de account-purge/dsar-sla): exige `Authorization: Bearer ${CRON_SECRET}`. SEM
 * `CRON_SECRET` no ambiente (deploy-gate humano) OU header ausente/errado → 401. O Vercel Cron injeta esse
 * header a partir do env `CRON_SECRET`; sem o secret, o endpoint fica FECHADO (o job não roda).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a limpeza a cada disparo.

export async function GET(request: Request): Promise<Response> {
  // Fail-closed: sem secret no ambiente OU header != "Bearer <secret>" → 401 (comparação em tempo constante).
  if (!isAuthorizedCron(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const result = await cleanupRateLimit(getDb(), new Date())
  // Só a CONTAGEM (metadado não-sensível) — nunca chaves/IP no corpo/log.
  return Response.json(result)
}
