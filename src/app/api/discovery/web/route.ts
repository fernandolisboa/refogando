import { getDb, getWebSearchProvider } from '@/server/deps'
import { resolveLocale } from '@/i18n/locale'
import { loadWebSearchConfig } from '@/server/app-config'
import { stripControlChars } from '@/domain/search-terms'
import { MAX_QUERY_LEN } from '@/server/recipe/search'
import { isUrlAllowed, type WebSearchConfig } from '@/domain/web-search-config'
import {
  MAX_SITE_QUERIES,
  type WebSearchResult,
} from '@/server/web-search/web-search-provider'
import { reserveWebSearchQueries } from '@/server/web-search/usage-counter'
import { clientIpFromHeaders } from '@/server/http/params'
import { createDomainRateLimiter } from '@/server/import/rate-limit'
import { requireSession } from '@/server/auth/guard'

/**
 * Descoberta na WEB (#164, ADR-0019) — ponte de DESCOBERTA, NÃO a Busca criando. Dado um termo,
 * devolve POUCOS links externos `{ title, url, sourceName }`, SEM armazenar nada nem ranquear (a Busca
 * só encontra; estes links vivem numa seção SEPARADA, fora do ranking interno). O cliente só chama
 * isto QUANDO o acervo local veio raso (gating no `search-experience`), pra não taxar o caminho quente.
 *
 * EXIGE SESSÃO (hardening pós-merge #464): a descoberta na web dispara consultas Brave PAGAS, então
 * reduzimos a superfície de abuso anônimo — só usuários LOGADOS a acionam. O Visitante NÃO recebe 401
 * (não quebra a UI dele): degradamos para `{ results: [] }`, a MESMA degradação graciosa que a rota já
 * pratica (desligado / allowlist vazia / erro) — ele só não vê a seção de links externos. Combinado com o
 * teto diário menor (`DAILY_WEB_SEARCH_QUERY_CAP`), é defesa em profundidade. Respeita `webSearchEnabled`:
 * desligado ⇒ `{ results: [] }` (200, nunca erro). O provedor concreto/credencial é GATE HUMANO de deploy
 * — sem ele o seam Real devolve `[]` (a feature degrada graciosamente para só o acervo local).
 *
 * Defesa em profundidade: filtra a saída do provedor pela MESMA allowlist (fonte única) — um link cujo
 * host saiu da curadoria NUNCA chega ao cliente, mesmo que o provedor erre.
 *
 * Teto de GASTO (#464): a rota é ANÔNIMA e cada chamada dispara até `MAX_SITE_QUERIES` consultas Brave
 * PAGAS. Duas defesas ANTES de tocar o provedor: (1) rate-limit best-effort POR IP (in-memory, ~1/s, o
 * mesmo motor do /import e /takedown); (2) um teto DIÁRIO GLOBAL de consultas persistido/atômico
 * (`reserveWebSearchQueries`). Estourar QUALQUER um ⇒ `{ results: [] }` — a MESMA degradação graciosa
 * que a rota já pratica (desligado / allowlist vazia / erro), nunca um erro.
 *
 * GET `?q=` (+ `?locale=` opcional). Resposta: `{ results: WebSearchResult[] }`.
 */

export const runtime = 'nodejs' // postgres-js (config) exige Node, não Edge.

// Rate-limit best-effort POR IP (mesmo motor do /import e /takedown): estado in-memory NA INSTÂNCIA
// serverless — cada instância tem o seu Map e um cold start zera a janela, então NÃO é quota dura, é
// anti-flood/politeness (~1 consulta/s por IP). O teto DURO de gasto é o contador diário global
// (persistido). Módulo-escopo p/ persistir entre requests da mesma instância.
const webSearchThrottle = createDomainRateLimiter({ minIntervalMs: 1000 })

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // Neutraliza C0/NUL como a Busca (search/route.ts) e capa o tamanho (anti-abuso).
  const q = stripControlChars(url.searchParams.get('q') ?? '')
    .trim()
    .slice(0, MAX_QUERY_LEN)
  const locale = resolveLocale({ preferred: url.searchParams.get('locale') })

  // Termo vazio ⇒ nada a descobrir (espelha o early-return neutro da Busca), sem tocar provedor/DB.
  if (q.length === 0) return Response.json({ results: [] })

  // EXIGE SESSÃO (hardening #464): só logados disparam a consulta paga. Anônimo NÃO recebe 401 (não quebra
  // a UI do visitante) — degrada para vazio, a MESMA degradação graciosa da rota. Reduz a superfície de
  // abuso anônimo antes mesmo do rate-limit/teto.
  const g = await requireSession(request)
  if (!g.ok) return Response.json({ results: [] })

  // Anti-flood POR IP ANTES de config/DB/provedor (shed barato). IP ausente (local/teste, sem proxy na
  // frente) ⇒ fail-open: não temos chave por-cliente, não punimos todo mundo num balde global.
  const ip = clientIpFromHeaders(request)
  if (ip && !webSearchThrottle.tryAcquire(ip)) return Response.json({ results: [] })

  let cfg: WebSearchConfig
  try {
    cfg = await loadWebSearchConfig(getDb())
  } catch {
    // Falha de DB na leitura da config ⇒ degrada para vazio (descoberta é assistiva, nunca 500).
    return Response.json({ results: [] })
  }

  // Desligado OU allowlist vazia ⇒ vazio (fail-closed). NÃO toca o provedor.
  if (!cfg.enabled || cfg.allowlist.length === 0) return Response.json({ results: [] })

  // Teto de GASTO diário (#464): reserva ATÔMICA de exatamente as consultas que o provedor VAI disparar
  // — uma por domínio, capado em `MAX_SITE_QUERIES` (mesma conta do fan-out do RealWebSearchProvider).
  // Estourou o teto do dia ⇒ degrada para vazio (não gasta a chamada paga). Falha de DB na reserva ⇒
  // fail-closed (não arrisca gastar sem contabilizar): também degrada para vazio.
  const plannedQueries = Math.min(cfg.allowlist.length, MAX_SITE_QUERIES)
  let reserved: boolean
  try {
    reserved = await reserveWebSearchQueries(getDb(), { count: plannedQueries })
  } catch {
    reserved = false
  }
  if (!reserved) return Response.json({ results: [] })

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
