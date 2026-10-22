import { accountExportFilename } from '@/domain/account-export'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { buildAccountExport } from '@/server/legal/account-export'

/**
 * GET /api/me/export — ACESSO + PORTABILIDADE dos dados da conta (issue #401, GAP-6; LGPD Art. 18
 * II/V; `docs/legal/takedown-e-remocao-titular.md` §8). Dump LEGÍVEL/PORTÁVEL (JSON) dos dados DO
 * PRÓPRIO titular.
 *
 * Owner-only via `requireSession` (ADR-0011, mesma tese de /api/me): 401 = Visitante (sem sessão) ou
 * conta soft-deletada. SEM parâmetro de caminho / id do cliente ⇒ nenhuma superfície de IDOR — o
 * dump é SEMPRE `session.user.id`. NUNCA inclui PII de terceiros (ver `buildAccountExport`).
 *
 * `Content-Disposition: attachment` torna a resposta um download (o titular guarda/reimporta o JSON). O
 * nome leva a data (`refogando-meus-dados-YYYY-MM-DD.json`, #595), do MESMO instante do `exportedAt`. A
 * seção "Seus dados" do /me/profile baixa por fetch + blob, com o mesmo nome.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

export async function GET(req: Request): Promise<Response> {
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const now = new Date()
  const dump = await buildAccountExport(getDb(), g.session.user.id, now)

  return new Response(JSON.stringify(dump, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${accountExportFilename(now)}"`,
      // Dados pessoais: nunca cacheados por intermediários (a resposta é por-titular e sensível).
      'cache-control': 'no-store',
    },
  })
}
