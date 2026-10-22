import { requireSession } from '@/server/auth/guard'
import { getDb } from '@/server/deps'
import { emailVerificationRequired } from '@/lib/auth'
import { publicAccountFilter } from '@/server/auth/pending-account'
import { followStatusByHandles } from '@/server/user/follow'
import { HANDLE_MAX_LEN, normalizeHandle } from '@/domain/handle'
import { stripControlChars } from '@/domain/search-terms'

/**
 * "Eu sigo?" em LOTE (#588, ADR-0024) — `POST /api/me/following/status` com `{ handles: string[] }` →
 * `{ following: string[], self: string | null }`. Existe porque a busca de Cozinheiros (`/api/search/cooks`)
 * é COOKIE-FREE de propósito (viewer-independente, cacheável): sem isto o cartão de um já-seguido nascia
 * "Seguir" no `/cooks?q=`. A ilha logada (`cooks-discovery.tsx`) pergunta aqui depois de cada página da
 * busca; a busca em si não muda.
 *
 * POST (e não GET `?handles=`) pra o lote de quem o viewer procura NÃO ir parar em log de acesso/CDN.
 * `requireSession` ANTES de tudo (anônimo ⇒ 401, zero DB). Corpo: `handles` precisa ser um array de no
 * máximo `MAX_HANDLES` (o dobro de folga sobre a página da busca); fora disso / JSON malformado ⇒ 400
 * `dados_invalidos`. Cada item: não-string, vazio, com caractere de controle (um NUL estoura o postgres-js)
 * ou maior que `HANDLE_MAX_LEN` é DESCARTADO (não casaria handle nenhum); o resto passa por `normalizeHandle`
 * (mesma forma de lookup do perfil e da rota de seguir) e é deduplicado.
 *
 * Leak-safe: devolve só handles ARMAZENADOS de contas PÚBLICAS (`publicAccountFilter`, o mesmo da rota de
 * seguir) — conta soft-deletada/pendente fica de fora, indistinguível de inexistente; NUNCA id. O viewer não
 * aprende nada que o perfil público (`GET /api/u/<handle>/follow`, um por um) já não lhe dissesse.
 * Resposta pessoal ⇒ `cache-control: no-store`.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/** Teto do lote por chamada. A busca pagina de 10 em 10 (`COOK_SEARCH_LIMIT`); 50 é folga, não alvo. */
const MAX_HANDLES = 50

function invalid(): Response {
  return Response.json({ error: 'dados_invalidos' }, { status: 400 })
}

/** Lote saneado (ver cabeçalho) ou `null` quando o corpo não tem a forma esperada. */
function parseHandles(body: unknown): string[] | null {
  const raw = (body as { handles?: unknown } | null)?.handles
  if (!Array.isArray(raw) || raw.length > MAX_HANDLES) return null
  const out = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || stripControlChars(item) !== item) continue
    const h = normalizeHandle(item)
    if (h !== null && h.length <= HANDLE_MAX_LEN) out.add(h)
  }
  return [...out]
}

export async function POST(request: Request): Promise<Response> {
  const g = await requireSession(request)
  if (!g.ok) return g.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return invalid()
  }
  const handles = parseHandles(body)
  if (handles === null) return invalid()

  const status = await followStatusByHandles(
    getDb(),
    g.session.user.id,
    handles,
    publicAccountFilter(emailVerificationRequired()),
  )
  return Response.json(status, { headers: { 'cache-control': 'no-store' } })
}
