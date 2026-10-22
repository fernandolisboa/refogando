import { accountExportFilename, jsonObjectChunks } from '@/domain/account-export'
import { formatServerErrorLine } from '@/domain/error-report'
import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { crossSiteForbidden, isCrossSiteRequest } from '@/server/http/same-origin'
import { textChunkStream } from '@/server/http/text-chunk-stream'
import { accountExportSections } from '@/server/legal/account-export'

/**
 * GET /api/me/export — ACESSO + PORTABILIDADE dos dados da conta (issue #401, GAP-6; LGPD Art. 18,
 * II e V; `docs/legal/takedown-e-remocao-titular.md` §6). Dump LEGÍVEL/PORTÁVEL (JSON) dos dados DO
 * PRÓPRIO titular.
 *
 * Owner-only via `requireSession` (ADR-0011, mesma tese de /api/me): 401 = Visitante (sem sessão) ou
 * conta soft-deletada. SEM parâmetro de caminho / id do cliente ⇒ nenhuma superfície de IDOR — o
 * dump é SEMPRE `session.user.id`. NUNCA inclui PII de terceiros (ver `accountExportSections`).
 *
 * Mesma origem (#595): só a própria interface (`Sec-Fetch-Site: same-origin`) ou o endereço digitado na
 * barra (`none`) baixam; outro site recebe 403 antes de olhar a sessão. Sem isso, uma página de fora abriria
 * a URL numa janela e forçaria o download, ou usaria a resposta como oráculo de "esta pessoa está logada".
 *
 * Em streaming (#595): as seções saem uma de cada vez (`jsonObjectChunks` + `textChunkStream`), com o mesmo
 * texto que um `JSON.stringify(dump, null, 2)` daria; ver `accountExportSections` para o porquê. Uma falha no
 * meio do corpo derruba a conexão (o cliente vê erro de rede, nunca um JSON cortado com cara de arquivo) e
 * escreve a linha `[erro] origem=servidor` do `onRequestError`, que não vê erro depois da resposta começar.
 * O cliente que cancela (aba fechada, navegação, HEAD) só para o gerador, sem linha de erro.
 *
 * `Content-Disposition: attachment` torna a resposta um download (o titular guarda/reimporta o JSON). O
 * nome leva a data (`refogando-meus-dados-YYYY-MM-DD.json`, #595), do MESMO instante do `exportedAt`. A
 * seção "Seus dados" do /me/profile baixa por fetch + blob e nomeia o arquivo pelo relógio do navegador:
 * mesmo formato, data não necessariamente igual à do `exportedAt` (ver `src/domain/account-export.ts`).
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/** Os valores aceitos de `Sec-Fetch-Site`: a interface e o endereço digitado. */
const EXPORT_ALLOWED_SITES = ['same-origin', 'none'] as const

export async function GET(req: Request): Promise<Response> {
  if (isCrossSiteRequest(req, EXPORT_ALLOWED_SITES)) return crossSiteForbidden()
  const g = await requireSession(req)
  if (!g.ok) return g.response

  const now = new Date()
  const chunks = jsonObjectChunks(accountExportSections(getDb(), g.session.user.id, now))

  const body = textChunkStream(chunks, (err) =>
    console.error(formatServerErrorLine(err, 'GET', { routePath: '/api/me/export', routeType: 'route' })),
  )

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${accountExportFilename(now)}"`,
      // Dados pessoais: nunca cacheados por intermediários (a resposta é por-titular e sensível).
      'cache-control': 'no-store',
    },
  })
}
