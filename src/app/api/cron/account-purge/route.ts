import { getDb, getImageStore } from '@/server/deps'
import { purgeAnonymizedAccounts } from '@/server/legal/account-purge-scan'
import { purgeStalePendingSignups } from '@/server/auth/pending-signup-purge'

/**
 * Cron de EXPURGO FÍSICO pós-retenção das contas anonimizadas (issue #411, LGPD Art. 16; `docs/legal/
 * takedown-e-remocao-titular.md` §6/§8). GET diário (Vercel Cron — ver `vercel.json`) que varre as contas
 * anonimizadas (#401) passadas do prazo de retenção e remove a PII RESIDUAL em storage (fotos das
 * avaliações), nulando os ponteiros — contas anonimizadas: SEM hard-delete das linhas (conteúdo mantido).
 * Idempotente. Agendado 30min DEPOIS do dsar-sla p/ não concorrer no mesmo minuto.
 *
 * Na mesma passada, APAGA (hard-delete) os CADASTROS PENDENTES abandonados (#470 follow-up, ADR-0014): contas de
 * email+senha criadas com a confirmação ligada e nunca provadas em 48h (`purgeStalePendingSignups`). As duas
 * varreduras são independentes: a falha de uma não impede a outra; qualquer falha responde 500 (só com o nome do
 * erro no log) para aparecer no painel de crons.
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
  let failed = false
  const run = async <T extends object>(what: string, job: () => Promise<T>): Promise<T | object> => {
    try {
      return await job()
    } catch (err) {
      failed = true
      console.error(`[account-purge] ${what} falhou: ${err instanceof Error ? err.name : 'erro'}`)
      return {}
    }
  }
  const anonymized = await run('expurgo de contas anonimizadas', () =>
    purgeAnonymizedAccounts(getDb(), getImageStore(), now),
  )
  const pending = await run('expurgo de cadastros pendentes', () => purgeStalePendingSignups(getDb(), now))
  // Só CONTAGENS (metadado não-sensível) — nunca dado do titular no corpo/log.
  return Response.json({ ...anonymized, ...pending }, { status: failed ? 500 : 200 })
}
