import { getDb } from '@/server/deps'
import { isAuthorizedCron } from '@/server/http/cron-auth'
import { errorLogFields } from '@/domain/error-report'
import { RETENTION_BUDGET_MS, RETENTION_RESERVE_MS, RETENTION_STEPS } from '@/server/legal/data-retention'
import { timeBudget } from '@/server/time-budget'

/**
 * Cron de RETENÇÃO (issue #473, ADR-0049; `docs/legal/registro-de-operacoes.md`): apaga o que passou do prazo
 * — registros de uso de IA (24 meses; extração, 30 dias), sessões e verificações vencidas, tickets de takedown
 * encerrados há 12 meses, auditoria DSAR com 5 anos, os cascos de criação das contas eliminadas e o custo das
 * gerações antigas de contas vivas. GET diário (Vercel Cron — `vercel.json`), depois dos demais crons.
 *
 * Os passos (`RETENTION_STEPS`) rodam em sequência, cada um no seu `run`: a falha de um não impede os outros
 * e faz a passada responder 500 (só nome + código do erro no log, ADR-0048). Orçamento de tempo da passada
 * (40 s, reserva de 15 s): com ele esgotado, os passos restantes ficam para amanhã (`deferredSteps=N` na
 * linha) — nada é apagado pela metade além do lote em curso, e cada passada progride. Toda passada termina
 * com UMA linha `[retencao]` com as contagens (só números).
 *
 * FAIL-CLOSED (mesmo padrão dos outros crons): exige `Authorization: Bearer ${CRON_SECRET}`; sem o secret no
 * ambiente OU header ausente/errado → 401, sem corpo.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a retenção a cada disparo.
// O orçamento da passada é de 40 s (`RETENTION_BUDGET_MS`); 60 s dá folga para o lote em curso terminar.
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Um relógio só, do começo da rota: o tempo de um passo sai do que sobra para os seguintes.
  const budget = timeBudget({ budgetMs: RETENTION_BUDGET_MS, reserveMs: RETENTION_RESERVE_MS })
  const now = new Date()
  const db = getDb()
  let failed = false
  let deferredSteps = 0
  const counts: Record<string, number> = {}

  for (const step of RETENTION_STEPS) {
    if (!budget.canStartMore()) {
      deferredSteps += 1
      continue
    }
    try {
      counts[step.key] = await step.run(db, now, { budget })
    } catch (err) {
      failed = true
      console.error(`[retencao] ${step.label} falhou: ${errorLogFields(err)}`)
    }
  }
  if (deferredSteps > 0) counts.deferredSteps = deferredSteps

  // Só CONTAGENS (metadado não-sensível) — nunca ids nem dado de titular no corpo/log.
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  const log = failed ? console.warn : console.info
  log(`[retencao] passada ${failed ? 'com falha' : 'concluída'}: ${summary || 'sem contagens'}`)
  return Response.json(counts, { status: failed ? 500 : 200 })
}
