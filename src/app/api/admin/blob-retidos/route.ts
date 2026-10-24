import { requireRole } from '@/server/auth/guard'
import { getDb, getImageStore } from '@/server/deps'
import { errorLogFields } from '@/domain/error-report'
import { BLOB_SWEEP_BUDGET_MS, BLOB_SWEEP_RESERVE_MS, listRetainedOrphans } from '@/server/images/blob-sweep'
import { timeBudget } from '@/server/time-budget'

/**
 * GET /api/admin/blob-retidos — ADMIN-ONLY, só leitura (#635). Lista os órfãos RETIDOS do Blob (sem referência no
 * banco e anteriores a 2026-09-19, que a varredura semanal nunca apaga sozinha) com caminho, URL e data, para o
 * admin decidir o que fazer com eles. Não apaga nem re-encoda nada. Abre direto no navegador com a sessão de admin.
 *
 * O log leva só a contagem (`[blob-sweep] listagem de retidos: retidos=N …`); caminhos e URLs saem só na resposta.
 * SÓ EM PRODUÇÃO, como o cron (`/api/cron/blob-sweep`): num Preview o banco é um branch antigo do Neon e quase
 * tudo pareceria órfão. Fora de produção (e fora dos testes) responde `{ pulada: 1 }`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'admin')
  if (!g.ok) return g.response

  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv ? vercelEnv !== 'production' : process.env.NODE_ENV !== 'test') {
    return Response.json({ pulada: 1 }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const budget = timeBudget({ budgetMs: BLOB_SWEEP_BUDGET_MS, reserveMs: BLOB_SWEEP_RESERVE_MS })
  try {
    const result = await listRetainedOrphans(getDb(), getImageStore(), { now: new Date(), budget })
    console.info(
      `[blob-sweep] listagem de retidos: retidos=${result.retidos.length} listagemIncompleta=${result.listagemIncompleta}`,
    )
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.warn(`[blob-sweep] listagem de retidos com falha: ${errorLogFields(err)}`)
    return Response.json({ error: 'falha' }, { status: 500 })
  }
}
