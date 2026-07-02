import { getDb } from '@/server/deps'
import { scanDsarSla } from '@/server/legal/dsar-sla-scan'

/**
 * Cron de ALERTAS de SLA dos pedidos do titular / takedown (issue #400, GAP-7; `docs/legal/takedown-e-
 * remocao-titular.md` §3). GET diário (Vercel Cron — ver `vercel.json`) que varre os tickets ABERTOS e
 * AVANÇA o `sla_level` de cada um (amarelo ≥10d, vermelho ≥13d = escalonamento, vencido ≥15d). O alerta é
 * ESTADO gravado (queryável), NÃO envio de e-mail — não há mailer/canal ligado (human-gated). Idempotente.
 *
 * FAIL-CLOSED (igual ao gate de deploy do `WEB_SEARCH_API_KEY`): exige `Authorization: Bearer
 * ${CRON_SECRET}`. SEM `CRON_SECRET` no ambiente (deploy-gate humano) OU header ausente/errado → 401. O
 * Vercel Cron injeta esse header automaticamente a partir do env `CRON_SECRET`; sem o secret, o endpoint
 * fica FECHADO (o job não roda). Não vaza corpo/detalhe em nenhum caminho.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a varredura a cada disparo.

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  // Fail-closed: sem secret no ambiente OU header != "Bearer <secret>" → 401.
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const result = await scanDsarSla(getDb(), new Date())
  // Só CONTAGENS (metadado não-sensível) — nunca dado do titular no corpo/log.
  return Response.json({ scanned: result.scanned, transitions: result.transitions.length })
}
