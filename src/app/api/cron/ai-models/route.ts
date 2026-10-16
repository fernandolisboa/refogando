import { getDb, getModelCatalog, getModelProbe } from '@/server/deps'
import { autoUpgradeModels } from '@/server/claude/model-auto-upgrade'

/**
 * Cron da troca AUTOMÁTICA de versão dos modelos de IA (ADR-0046). GET diário
 * (Vercel Cron — ver `vercel.json`): para cada tarefa com "Atualizar sozinho" ligado, testa o mais
 * novo da mesma família com uma chamada real e troca só se a Anthropic aceitar (`autoUpgradeModels`).
 *
 * Toda passada termina com UMA linha `[ai-models] passada concluída: …` com as contagens; cada troca,
 * recusa ou teste indisponível tem a sua linha `[ai-models] <tarefa>: …` antes dela (logs da Vercel).
 * Models API fora ⇒ `semLista=1` e nada muda. Só um erro inesperado (banco fora) responde 500.
 *
 * FAIL-CLOSED (mesmo padrão dos outros crons): exige `Authorization: Bearer ${CRON_SECRET}`. SEM
 * `CRON_SECRET` no ambiente OU header ausente/errado → 401. Para trocar antes do horário, rode o job à
 * mão no painel da Vercel (Settings → Cron Jobs → Run).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// As chamadas de teste param de começar aos 35s (`PROBE_BUDGET_MS`); a pior (20s) termina antes dos 60s.
export const maxDuration = 60

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const summary = await autoUpgradeModels(getDb(), {
      catalog: getModelCatalog(),
      probe: getModelProbe(),
    })
    const counts: Record<string, number> = {}
    if (summary.kind === 'semLista') counts.semLista = 1
    else for (const o of summary.outcomes) counts[o.kind] = (counts[o.kind] ?? 0) + 1
    const line = Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    console.info(`[ai-models] passada concluída: ${line}`)
    return Response.json(summary)
  } catch (err) {
    console.warn(`[ai-models] passada com falha: ${err instanceof Error ? err.name : 'erro'}`)
    return Response.json({ error: 'falha' }, { status: 500 })
  }
}
