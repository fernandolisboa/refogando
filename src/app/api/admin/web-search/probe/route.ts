import { requireRole } from '@/server/auth/guard'
import { getRecipeProbe } from '@/server/deps'
import { parseProbeUrl } from '@/server/import/probe-url'
import type { ProbeReport } from '@/domain/web-search-probe'

export const runtime = 'nodejs'

/**
 * PROBE de saúde de uma URL de receita (#273, ADR-0019) — ADMIN-ONLY (Curador/Usuário → 403; sem sessão →
 * 401; espelha `/api/admin/config`). Recebe `{ url }`, busca a página + o robots.txt e devolve um
 * `ProbeReport` (JSON-LD presente? robots permite? → "importável?"). NÃO persiste nada e NÃO toca a config
 * (allowlist) — é só um check de uma URL ainda-NÃO-vetada, antes de o admin decidir adicioná-la.
 *
 * SEGURANÇA (SSRF) — este é o PRIMEIRO ponto onde URL admin-arbitrária chega ao `fetch` SEM a barreira de
 * allowlist (que o `/api/recipes/import` documenta como sua defesa). A substituem: `parseProbeUrl` (só
 * http(s), rejeita IP privado/loopback/link-local e hostnames internos por VALOR, ANTES de qualquer rede)
 * + a resolução DNS por endereço no seam (defesa contra rebind) + follow de redirect limitado/re-validado.
 * POST (não GET): a URL fica fora de query-logs/referrer, e o cookie Better Auth é SameSite=Lax (o default
 * bloqueia POST cross-site → CSRF). Runtime nodejs (precisa de `node:dns`/`node:net`).
 *
 * RESÍDUO ACEITO (documentado): TOCTOU entre a resolução DNS e a conexão; pin-no-IP deferido p/ v2 (quebra
 * TLS de https). Rate-limiter de politeness PULADO (admin-only manual). Proporcional p/ ferramenta interna.
 *
 * "NUNCA 500": o seam não lança por contrato; o try/catch é cinto-e-suspensório — um erro inesperado vira
 * um veredito TRATADO (`fetched:false`), nunca um 500 com stack.
 */
export async function POST(req: Request): Promise<Response> {
  const g = await requireRole(req, 'admin')
  if (!g.ok) return g.response

  const body = (await req.json().catch(() => ({}))) as { url?: unknown }
  // Barreira de SSRF ANTES de qualquer rede: URL inválida/privada ⇒ 400, sem tocar o seam (nem a allowlist).
  const url = parseProbeUrl(body.url)
  if (url === null) {
    return Response.json({ error: 'url_invalida' }, { status: 400 })
  }

  try {
    const report = await getRecipeProbe().probe(url)
    return Response.json(report)
  } catch {
    // Contrato "NUNCA 500": devolve um veredito tratado (não-buscável) em vez de vazar stack.
    const fallback: ProbeReport = { fetched: false, jsonLd: 'absent', robotsAllowed: true }
    return Response.json(fallback)
  }
}
