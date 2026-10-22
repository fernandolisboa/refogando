import { getDb, getImageStore } from '@/server/deps'
import {
  accountPurgeBudget,
  purgeAnonymizedAccounts,
  purgeAnonymizedPrivateContent,
  type PrivatePurgeResult,
} from '@/server/legal/account-purge-scan'
import { purgeStalePendingSignups } from '@/server/auth/pending-signup-purge'
import { isAuthorizedCron } from '@/server/http/cron-auth'
import { errorLogFields } from '@/domain/error-report'

/**
 * Cron das contas anonimizadas e dos cadastros abandonados (issues #411/#473, LGPD Art. 16; ADR-0049;
 * `docs/legal/takedown-e-remocao-titular.md` §6/§8). GET diário (Vercel Cron — ver `vercel.json`), três
 * varreduras em sequência:
 *  1. `purgeStalePendingSignups` (#470 follow-up, ADR-0014): APAGA (hard-delete) os CADASTROS PENDENTES
 *     abandonados — contas de email+senha criadas com a confirmação ligada e nunca provadas em 48h. Vai
 *     primeiro: é barata e carrega a promessa das 48 h, que não pode depender do tempo das outras.
 *  2. `purgeAnonymizedAccounts`: nas contas anonimizadas (#401) passadas do prazo de retenção (180 dias),
 *     remove a PII RESIDUAL em storage (fotos das avaliações) e nula os ponteiros. A linha `users`, as
 *     Receitas públicas e as avaliações ficam (anonimizadas).
 *  3. `purgeAnonymizedPrivateContent` (#473): em toda conta anonimizada, sem espera, apaga o conteúdo
 *     PRIVADO que sobrou (contas eliminadas antes do #473 e sobras de corrida). Uma conta que falha não
 *     derruba as outras, mas a passada responde 500.
 * O orçamento de tempo é UM para a passada inteira, contado do começo da rota (`accountPurgeBudget`): a
 * varredura do privado não começa conta nova sem a reserva, e as que ficaram saem como
 * `privateAccountsDeferred=N` na linha (o corte nunca é silencioso).
 * Idempotente. Agendado 30min DEPOIS do dsar-sla p/ não concorrer no mesmo minuto. As varreduras são
 * independentes: a falha de uma não impede as outras; qualquer falha responde 500 (só nome e código do erro
 * no log, ADR-0048) para aparecer no painel de crons. Toda passada termina com UMA linha `[account-purge]`
 * com as contagens (só números).
 *
 * FAIL-CLOSED (igual ao dsar-sla): exige `Authorization: Bearer ${CRON_SECRET}`. SEM `CRON_SECRET` no
 * ambiente (deploy-gate humano) OU header ausente/errado → 401. O Vercel Cron injeta esse header a partir
 * do env `CRON_SECRET`; sem o secret, o endpoint fica FECHADO (o job não roda). Não vaza corpo/detalhe.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a varredura a cada disparo.
// O orçamento da passada é de 40 s (`ACCOUNT_PURGE_BUDGET_MS`); 60 s dá folga para a conta em curso terminar.
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  // Fail-closed: sem secret no ambiente OU header != "Bearer <secret>" → 401 (comparação em tempo constante).
  if (!isAuthorizedCron(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const budget = accountPurgeBudget() // um relógio só, do começo da rota (doc do módulo)
  const now = new Date()
  let failed = false
  const run = async <T extends object>(what: string, job: () => Promise<T>): Promise<T | object> => {
    try {
      return await job()
    } catch (err) {
      failed = true
      console.error(`[account-purge] ${what} falhou: ${errorLogFields(err)}`)
      return {}
    }
  }
  const pending = await run('expurgo de cadastros pendentes', () => purgeStalePendingSignups(getDb(), now))
  const anonymized = await run('expurgo de contas anonimizadas', () =>
    purgeAnonymizedAccounts(getDb(), getImageStore(), now),
  )
  const privateContent = await run('conteúdo privado de contas anonimizadas', () =>
    purgeAnonymizedPrivateContent(getDb(), getImageStore(), now, { budget }),
  )
  // A varredura do privado isola a falha por conta (não lança); a conta que falhou ainda faz a passada falhar.
  if ((privateContent as Partial<PrivatePurgeResult>).privateAccountsFailed) failed = true
  // Só CONTAGENS (metadado não-sensível) — nunca dado do titular no corpo/log. A linha de log é o que mostra, nos
  // logs da Vercel, quanto cada passada apagou (o painel de crons só guarda o status). Na ordem em que rodaram.
  const counts = { ...pending, ...anonymized, ...privateContent }
  // Só campos NUMÉRICOS entram na linha: um campo novo não-numérico nos resultados (ex.: lista de ids) não vaza.
  const summary = Object.entries(counts)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  const log = failed ? console.warn : console.info
  log(`[account-purge] passada ${failed ? 'com falha' : 'concluída'}: ${summary || 'sem contagens'}`)
  return Response.json(counts, { status: failed ? 500 : 200 })
}
