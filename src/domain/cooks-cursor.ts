/**
 * Cursores keyset OPACOS da Descoberta de Cozinheiros (#308). Dois formatos:
 *  - **recomendações** `(score:float, recency:timestamptz, handle)` — ordem all-DESC (#368: o score
 *    virou a mistura de popularidade, um FLOAT arredondado a 6 casas — não mais um inteiro de contagem);
 *  - **busca**         `(rank:int, name:text, handle)` — ordem all-ASC.
 *
 * Ambos = base64url de JSON via `Buffer` (utf8): o `name` da busca pode ter acento/unicode, então NÃO
 * dá pra usar `btoa` (Latin1) como o cursor do feed; só rotas/loaders (Node) os tocam, nunca o cliente
 * (que os devolve verbatim). OPACOS À UI, NÃO secretos — carregam só a posição keyset; o leak via
 * base64 é dos mesmos campos públicos do #307 (popularidade por saves públicos, timestamp de
 * receita pública, handle público). **ALLOWLIST (#269/Modelo B): o tiebreak é o `handle` PÚBLICO — o
 * `id` interno NUNCA entra no cursor.**
 *
 * Decodificar é TOLERANTE e VALIDA o VALOR de cada campo ANTES de devolver — base64 inválido, forma
 * errada, `score` não-finito (NaN/±Infinity) ou `rank` não-inteiro, `recency` fora do formato
 * timestamptz, `handle` fora do charset, ou control char (o NUL estoura o bind do postgres-js) ⇒ `null`,
 * e o chamador trata como PRIMEIRA página. As rotas são públicas: um `?cursor=` adulterado JAMAIS pode
 * virar 500. O cursor é minado de um probe `limit+1`, nunca de `rows.length < limit`.
 */

// Forma TEXTO do `timestamptz` do Postgres (`::text`) — com FAIXAS válidas (mês 01-12, dia 01-31, hora
// 00-23, min/seg 00-59, offset 00-23[:00-59]). Sem as faixas, um cursor como `9999-99-99 99:99:99` passa
// a regex e estoura `::timestamptz` → 500. NÃO usar `Date.parse` como guarda: `Date.parse('2026-06-29
// 09:00:00-0300')` (forma legítima do `::text`) é NaN no V8 → rejeitaria cursores reais e travaria a paginação.
const TIMESTAMPTZ_RE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[ T]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?([+-]([01]\d|2[0-3])(:?[0-5]\d)?|Z)?$/
// Handle público (domain/handle.ts): [a-z0-9-], 3–30. Aqui basta "seguro de bindar" + plausível.
const CURSOR_HANDLE_RE = /^[a-z0-9-]{1,30}$/
// `rank` (cursor de BUSCA) vai pra uma coluna `::int` (int4). Um inteiro fora da faixa int4 passa
// `Number.isInteger` mas estoura o bind ("value out of range for integer") → 500 na rota (não-assistiva).
// Limita. (O `score` do cursor de RECOMENDAÇÕES é float8 desde o #368 — não usa estes limites.)
const INT4_MIN = -2147483648
const INT4_MAX = 2147483647

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
  // #368: `score` é FLOAT (mistura de popularidade, arredondada a 6 casas no CTE) — não mais um inteiro
  // de contagem. Aceita qualquer float finito; rejeita NaN/±Infinity (que quebrariam o bind ::float8 e a
  // comparação keyset). `Number.isFinite` já cobre os dois (NaN e ±Infinity são não-finitos).
  if (typeof s !== 'number' || !Number.isFinite(s)) return null
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
  if (typeof k !== 'number' || !Number.isInteger(k) || k < INT4_MIN || k > INT4_MAX) return null
  // `name` é texto livre (bindado como param → injection-safe), mas rejeitamos control chars (o NUL
  // estoura o bind) e limitamos o tamanho (anti-abuso). Teto folgado (1024) p/ não rejeitar um nome real
  // longo — rejeitá-lo faria o cursor cair em page-1 e o cliente duplicar a 1ª página em loop.
  if (typeof n !== 'string' || n.length > 1024 || hasControlChars(n)) return null
  if (typeof h !== 'string' || !CURSOR_HANDLE_RE.test(h)) return null
  return { rank: k, name: n, handle: h }
}
