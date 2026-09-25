import { getDb, getImageStore } from '@/server/deps'
import { purgeAnonymizedAccounts } from '@/server/legal/account-purge-scan'
import { purgeStalePendingAccounts } from '@/server/auth/pending-account'

/**
 * Cron de EXPURGO FÍSICO pós-retenção das contas anonimizadas (issue #411, LGPD Art. 16; `docs/legal/
 * takedown-e-remocao-titular.md` §6/§8). GET diário (Vercel Cron — ver `vercel.json`) que varre as contas
 * anonimizadas (#401) passadas do prazo de retenção e remove a PII RESIDUAL em storage (fotos das
 * avaliações), nulando os ponteiros — SEM hard-delete das linhas (conteúdo anonimizado é mantido).
 * Idempotente. Agendado 30min DEPOIS do dsar-sla p/ não concorrer no mesmo minuto.
 *
 * #470 (R1): a mesma passada APAGA as contas PENDENTES de confirmação de email há mais de 48h
 * (`purgeStalePendingAccounts` — sem sessão, sem conteúdo), limitando a 48h a janela de pré-sequestro.
 *
 * FAIL-CLOSED (igual ao dsar-sla): exige `Authorization: Bearer ${CRON_SECRET}`. SEM `CRON_SECRET` no
 * ambiente (deploy-gate humano) OU header ausente/errado → 401. O Vercel Cron injeta esse header a partir
 * do env `CRON_SECRET`; sem o secret, o endpoint fica FECHADO (o job não roda). Não vaza corpo/detalhe.
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

  const now = new Date()
  const result = await purgeAnonymizedAccounts(getDb(), getImageStore(), now)
  const pendingPurged = await purgeStalePendingAccounts(getDb(), now)
  // Só CONTAGENS (metadado não-sensível) — nunca dado do titular no corpo/log.
  return Response.json({ ...result, pendingPurged })
}
