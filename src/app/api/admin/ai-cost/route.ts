import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { loadAiCostSummary } from '@/server/admin/ai-cost'

export const runtime = 'nodejs'

/**
 * Painel de CUSTO de IA (#465) — ADMIN-ONLY (`requireRole 'admin'`; Curador/Usuário → 403, sem sessão →
 * 401, mesma guarda de `/api/admin/config` e `/api/admin/takedown-sla`). Agrega os DOIS ledgers de custo
 * já existentes (`generation` texto #463 + `image_generation` imagem #224) em três vistas: custo/dia,
 * custo/usuário top-N e custo do texto por desfecho (Receita salva/avaliada).
 *
 * Read-only: só LÊ os `cost_usd` SNAPSHOT — nenhuma mutação, nenhuma tabela nova. Dá visibilidade
 * contínua de margem e detecta heavy users. Só metadados agregados vão no corpo (o `email`/`handle` do
 * top-N já é visível ao Admin em `/admin/users`).
 */
export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'admin')
  if (!g.ok) return g.response

  const summary = await loadAiCostSummary(getDb())
  return Response.json(summary)
}
