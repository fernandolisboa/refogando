import { getDb, getWebSearchProvider } from '@/server/deps'
import { resolveLocale } from '@/i18n/locale'
import { loadWebSearchConfig } from '@/server/app-config'
import { stripControlChars } from '@/domain/search-terms'
import { MAX_QUERY_LEN } from '@/server/recipe/search'
import { isUrlAllowed, type WebSearchConfig } from '@/domain/web-search-config'
import type { WebSearchResult } from '@/server/web-search/web-search-provider'

/**
 * Descoberta na WEB (#164, ADR-0019) — ponte de DESCOBERTA, NÃO a Busca criando. Dado um termo,
 * devolve POUCOS links externos `{ title, url, sourceName }`, SEM armazenar nada nem ranquear (a Busca
 * só encontra; estes links vivem numa seção SEPARADA, fora do ranking interno). O cliente só chama
 * isto QUANDO o acervo local veio raso (gating no `search-experience`), pra não taxar o caminho quente.
 *
 * AUTH OPCIONAL: não exige sessão (Visitante também descobre). Respeita `webSearchEnabled`: desligado
 * ⇒ `{ results: [] }` (200, nunca erro). O provedor concreto/credencial é GATE HUMANO de deploy — sem
 * ele o seam Real devolve `[]` (a feature degrada graciosamente para só o acervo local).
 *
 * Defesa em profundidade: filtra a saída do provedor pela MESMA allowlist (fonte única) — um link cujo
 * host saiu da curadoria NUNCA chega ao cliente, mesmo que o provedor erre.
 *
 * GET `?q=` (+ `?locale=` opcional). Resposta: `{ results: WebSearchResult[] }`.
 */

export const runtime = 'nodejs' // postgres-js (config) exige Node, não Edge.

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // Neutraliza C0/NUL como a Busca (search/route.ts) e capa o tamanho (anti-abuso).
  const q = stripControlChars(url.searchParams.get('q') ?? '')
    .trim()
    .slice(0, MAX_QUERY_LEN)
  const locale = resolveLocale({ preferred: url.searchParams.get('locale') })

  // Termo vazio ⇒ nada a descobrir (espelha o early-return neutro da Busca), sem tocar provedor/DB.
  if (q.length === 0) return Response.json({ results: [] })

  let cfg: WebSearchConfig
  try {
    cfg = await loadWebSearchConfig(getDb())
  } catch {
    // Falha de DB na leitura da config ⇒ degrada para vazio (descoberta é assistiva, nunca 500).
    return Response.json({ results: [] })
  }

  // Desligado OU allowlist vazia ⇒ vazio (fail-closed). NÃO toca o provedor.
  if (!cfg.enabled || cfg.allowlist.length === 0) return Response.json({ results: [] })

  let results: WebSearchResult[]
  try {
    results = await getWebSearchProvider().search(q, { allowlist: cfg.allowlist, locale })
  } catch {
    // O seam NÃO deve lançar (contrato), mas blindamos: erro ⇒ vazio (degradação graciosa).
    results = []
  }

  // Defesa em profundidade: só links cujo host está na allowlist saem (mesma fonte do guard de SSRF).
  const safe = results.filter((r) => isUrlAllowed(r.url, cfg.allowlist))
  return Response.json({ results: safe })
}
