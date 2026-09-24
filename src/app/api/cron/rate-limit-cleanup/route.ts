import { getDb } from '@/server/deps'
import { cleanupRateLimit } from '@/server/rate-limit/cleanup'

/**
 * Cron de LIMPEZA da tabela `rate_limit` (#449, hardening pós-merge; ver `vercel.json`). O Better Auth
 * persiste um contador por chave em `storage:'database'` mas nunca o expurga — sem TTL, a tabela cresce sem
 * limite. GET diário (Vercel Cron) que apaga as linhas passadas da maior janela (via `cleanupRateLimit`),
 * limitando o crescimento sem tocar nenhum contador ainda ativo.
 *
 * FAIL-CLOSED (mesmo padrão de account-purge/dsar-sla): exige `Authorization: Bearer ${CRON_SECRET}`. SEM
 * `CRON_SECRET` no ambiente (deploy-gate humano) OU header ausente/errado → 401. O Vercel Cron injeta esse
 * header a partir do env `CRON_SECRET`; sem o secret, o endpoint fica FECHADO (o job não roda).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a limpeza a cada disparo.

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  // Fail-closed: sem secret no ambiente OU header != "Bearer <secret>" → 401.
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const result = await cleanupRateLimit(getDb(), new Date())
  // Só a CONTAGEM (metadado não-sensível) — nunca chaves/IP no corpo/log.
  return Response.json(result)
}
