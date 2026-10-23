import { getDb, getImageStore } from '@/server/deps'
import { isAuthorizedCron } from '@/server/http/cron-auth'
import { errorLogFields } from '@/domain/error-report'
import { BLOB_SWEEP_BUDGET_MS, BLOB_SWEEP_RESERVE_MS, sweepBlobs } from '@/server/images/blob-sweep'
import { timeBudget } from '@/server/time-budget'

/**
 * Cron SEMANAL do Blob (#603, ADR-0050): apaga os blobs que nenhuma linha do banco referencia e, até 2026-11-30,
 * re-encoda as fotos antigas que ainda têm EXIF/GPS (regras e travas em `@/server/images/blob-sweep`). Toda
 * passada termina com UMA linha `[blob-sweep]` só com contagens (catálogo em `docs/observabilidade.md`).
 *
 * SÓ EM PRODUÇÃO (fail-closed): um Preview roda contra um branch do Neon (cópia antiga do banco) e um `next dev`
 * pode ter um banco local com o token do Blob de produção; os dois veriam imagem de produção como órfã. Roda só
 * com `VERCEL_ENV=production` ou nos testes (`NODE_ENV=test`); fora disso responde `{ pulada: 1 }`.
 *
 * FAIL-CLOSED (mesmo padrão dos outros crons): exige `Authorization: Bearer ${CRON_SECRET}`; sem o secret no
 * ambiente OU header ausente/errado → 401, sem corpo.
 */

export const runtime = 'nodejs' // postgres-js + sharp exigem Node, não Edge.
export const dynamic = 'force-dynamic' // nunca cacheia; roda a varredura a cada disparo.
// O orçamento da passada é de 240 s (`BLOB_SWEEP_BUDGET_MS`); 300 s dá folga para a foto em curso terminar.
export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCron(request)) {
    return new Response('Unauthorized', { status: 401 })
  }
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv ? vercelEnv !== 'production' : process.env.NODE_ENV !== 'test') {
    console.info(`[blob-sweep] pulada: ambiente=${vercelEnv ?? 'local'}`)
    return Response.json({ pulada: 1 })
  }
  // Pausa manual (antes de restaurar um backup do banco; roteiro em `.github/workflows/db-backup.yml`).
  if (process.env.BLOB_SWEEP_PAUSE === '1') {
    console.info('[blob-sweep] pulada: pausa=1')
    return Response.json({ pulada: 1 })
  }

  const budget = timeBudget({ budgetMs: BLOB_SWEEP_BUDGET_MS, reserveMs: BLOB_SWEEP_RESERVE_MS })
  try {
    const counts = await sweepBlobs(getDb(), getImageStore(), { now: new Date(), budget })
    const summary = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    const log = counts.travada ? console.warn : console.info
    log(`[blob-sweep] passada ${counts.travada ? 'travada' : 'concluída'}: ${summary}`)
    return Response.json(counts)
  } catch (err) {
    console.warn(`[blob-sweep] passada com falha: ${errorLogFields(err)}`)
    return Response.json({ error: 'falha' }, { status: 500 })
  }
}
