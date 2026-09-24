import { requireRole } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { loadDivergentStaleTranslations } from '@/server/curate/translation-divergent-stale'

/**
 * Lista do Curador — traduções defasadas-E-divergentes (issue #500, ADR-0031 decisão 6). Evolui
 * a fila `translations/stale` (#23) para o caso em que a fonte mudou E o conteúdo já divergiu da
 * última MT (edição humana) ou é legado sem prova de intocabilidade (`mt_fingerprint IS NULL`) —
 * essas linhas NUNCA são auto-sobrescritas pela re-tradução automática (fatia B, #499); precisam
 * de re-revisão HUMANA pela rota de edição de tradução já existente (`translations/[locale]`).
 * Também lista as defasadas-e-INTOCADAS em quarentena do circuit-breaker da re-tradução (#520): o
 * tradutor falhou repetidamente nelas, então saíram do worker e precisam de mão humana. Cada item
 * traz `reason: 'divergente' | 'falha_traducao'`.
 *
 * MESMO gate de comunidade/moderação do template `translations/stale/route.ts` (não vaza receita
 * privada nem removida do pool) + papel Curador (401/403 via `requireRole`). Devolve só id+locale+
 * proveniência+motivo (nada de conteúdo sensível). GET read-only — a comparação de hash roda no app
 * (`loadDivergentStaleTranslations`), nenhuma escrita, nenhuma chamada a LLM.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const g = await requireRole(request, 'curador')
  if (!g.ok) return g.response

  const divergentStale = await loadDivergentStaleTranslations(getDb())

  return Response.json({ divergentStale }, { status: 200 })
}
