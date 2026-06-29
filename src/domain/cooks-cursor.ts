/**
 * Cursores keyset OPACOS da Descoberta de Cozinheiros (#308). Dois formatos:
 *  - **recomendações** `(score:int, recency:timestamptz, handle)` — ordem all-DESC;
 *  - **busca**         `(rank:int, name:text, handle)` — ordem all-ASC.
 *
 * Ambos = base64url de JSON via `Buffer` (utf8): o `name` da busca pode ter acento/unicode, então NÃO
 * dá pra usar `btoa` (Latin1) como o cursor do feed; só rotas/loaders (Node) os tocam, nunca o cliente
 * (que os devolve verbatim). OPACOS À UI, NÃO secretos — carregam só a posição keyset; o leak via
 * base64 é dos mesmos campos públicos do #307 (popularidade de votos/favoritos públicos, timestamp de
 * receita pública, handle público). **ALLOWLIST (#269/Modelo B): o tiebreak é o `handle` PÚBLICO — o
 * `id` interno NUNCA entra no cursor.**
 *
 * Decodificar é TOLERANTE e VALIDA o VALOR de cada campo ANTES de devolver — base64 inválido, forma
 * errada, `score`/`rank` não-inteiro, `recency` fora do formato timestamptz, `handle` fora do charset,
 * ou control char (o NUL estoura o bind do postgres-js) ⇒ `null`, e o chamador trata como PRIMEIRA
 * página. As rotas são públicas: um `?cursor=` adulterado JAMAIS pode virar 500. O cursor é minado de
 * um probe `limit+1`, nunca de `rows.length < limit`.
 */

// Forma TEXTO do `timestamptz` do Postgres (`::text`) — réplica local (a de recipe-feed-read é privada).
const TIMESTAMPTZ_RE =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?([+-]\d{2}(:?\d{2})?|Z)?$/
// Handle público (domain/handle.ts): [a-z0-9-], 3–30. Aqui basta "seguro de bindar" + plausível.
const CURSOR_HANDLE_RE = /^[a-z0-9-]{1,30}$/

/** Rejeita strings com controles C0 (codepoint < 0x20). O NUL faz o postgres-js estourar ao bindar um
 *  text param; o `name` livre, vindo de um cursor forjado, pode trazê-lo. Char-code (sem literal de
 *  controle no fonte) evita escapes frágeis. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 0x20) return true
  }
  return false
}

export type RecsCursor = { score: number; recency: string; handle: string }
export type SearchCursor = { rank: number; name: string; handle: string }

function encodeJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')
}

function decodeJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown
  } catch {
    return null
  }
}

function asRecord(p: unknown): Record<string, unknown> | null {
  return typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : null
}

export function encodeRecsCursor(c: RecsCursor): string {
  return encodeJson({ s: c.score, r: c.recency, h: c.handle })
}

export function decodeRecsCursor(raw: string | null): RecsCursor | null {
  const p = asRecord(decodeJson(raw))
  if (!p) return null
  const { s, r, h } = p
  if (typeof s !== 'number' || !Number.isInteger(s)) return null
  if (typeof r !== 'string' || !TIMESTAMPTZ_RE.test(r)) return null
  if (typeof h !== 'string' || !CURSOR_HANDLE_RE.test(h)) return null
  return { score: s, recency: r, handle: h }
}

export function encodeSearchCursor(c: SearchCursor): string {
  return encodeJson({ k: c.rank, n: c.name, h: c.handle })
}

export function decodeSearchCursor(raw: string | null): SearchCursor | null {
  const p = asRecord(decodeJson(raw))
  if (!p) return null
  const { k, n, h } = p
  if (typeof k !== 'number' || !Number.isInteger(k)) return null
  // `name` é texto livre (bindado como param → injection-safe), mas rejeitamos control chars (o NUL
  // estoura o bind) e limitamos o tamanho (um cursor forjado gigante não vira input ilimitado).
  if (typeof n !== 'string' || n.length > 256 || hasControlChars(n)) return null
  if (typeof h !== 'string' || !CURSOR_HANDLE_RE.test(h)) return null
  return { rank: k, name: n, handle: h }
}
