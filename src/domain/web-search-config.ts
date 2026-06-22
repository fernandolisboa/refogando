/**
 * Config da DESCOBERTA na WEB — admin-configurável (issue #164, ADR-0019). PURO: tipos + defaults +
 * validação + a checagem de ALLOWLIST (fonte ÚNICA de verdade compartilhada por DOIS consumidores —
 * o endpoint `/api/discovery/web` e o GUARD de SSRF do import `/api/recipes/import`).
 *
 * A Busca NUNCA cria; os links da web são uma PONTE de DESCOBERTA — externos, NÃO armazenados, FORA do
 * ranking interno (ADR-0019). Esta config liga/desliga a ponte e restringe a busca a uma ALLOWLIST de
 * domínios. O provedor concreto/credencial é GATE HUMANO de deploy (como a Gemini key) — o seam + Fake
 * + esta config ficam prontos; sem credencial, o Real se comporta como vazio/desligado.
 *
 * Forma `webSearch { enabled, allowlist }`:
 *  - `enabled`: liga/desliga a busca na web (desligada ⇒ o endpoint devolve vazio).
 *  - `allowlist`: lista de domínios (hostnames) permitidos. Vazia = NENHUM domínio liberado (fail-closed):
 *    sem allowlist o endpoint não tem onde buscar e o import recusa toda URL externa.
 *
 * `null` não aparece aqui (diferente do cap por papel): a config é um boolean + uma lista de strings.
 */

/** Config da descoberta na web (singleton `app_config`). */
export type WebSearchConfig = {
  enabled: boolean
  /** Domínios permitidos (hostnames canônicos, minúsculos). Vazio = fail-closed (nada liberado). */
  allowlist: string[]
}

/**
 * Default: descoberta na web DESLIGADA e allowlist VAZIA. Fail-closed por construção — a ponte só
 * existe depois que o admin a liga E define domínios E o deploy tem credencial (gate humano). Antes
 * disso o endpoint devolve vazio e o import recusa toda URL externa. Reversível pela `/admin/ai`.
 */
export const DEFAULT_WEB_SEARCH_CONFIG: WebSearchConfig = {
  enabled: false,
  allowlist: [],
}

/**
 * Teto de tamanho da allowlist (defesa contra jsonb gigante / abuso). Cobre qualquer curadoria real
 * de domínios de receita com folga.
 */
const MAX_ALLOWLIST = 50

/**
 * Canonicaliza um domínio cru da allowlist: trim + minúsculo + remove `www.` líder + remove um ponto
 * final. Devolve `null` para entradas que NÃO são um hostname plausível (vazio, com espaço, com
 * esquema/porta/caminho, sem ponto). Mantém a comparação de domínio simples e robusta (`isUrlAllowed`
 * casa o host da URL contra estes valores canônicos).
 */
export function canonicalizeDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let d = raw.trim().toLowerCase()
  if (d === '') return null
  // Sem esquema, porta, caminho, query, espaço ou arroba — só um hostname.
  if (/[\s/@?#:]/.test(d)) return null
  if (d.endsWith('.')) d = d.slice(0, -1)
  if (d.startsWith('www.')) d = d.slice(4)
  // Precisa de ao menos um ponto (rejeita `localhost`, TLD solto), sem rótulo vazio nem wildcard cru.
  if (!d.includes('.') || d.startsWith('.') || d.includes('..') || d.includes('*')) return null
  // Caracteres válidos de hostname (rótulos alfanuméricos + hífen, separados por ponto).
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return null
  return d
}

/**
 * Valida + canonicaliza uma allowlist crua (entrada do PUT do admin). Aceita um array de strings;
 * canonicaliza cada uma. Qualquer inválida ⇒ rejeita o lote inteiro (não engole silenciosamente um
 * domínio mal digitado). Dedup preservando a ordem. Acima do teto ⇒ rejeita. Devolve `null` em
 * qualquer desvio (o route mapeia a 400). PURO.
 */
export function parseAllowlist(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_ALLOWLIST) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const d = canonicalizeDomain(item)
    if (d === null) return null
    if (!seen.has(d)) {
      seen.add(d)
      out.push(d)
    }
  }
  return out
}

export type WebSearchConfigParse = { ok: true; value: WebSearchConfig } | { ok: false }

/**
 * Valida o objeto `webSearch` cru do PUT (substituição COMPLETA — a UI sempre envia os 2 campos).
 * `enabled` boolean; `allowlist` válida. Qualquer desvio ⇒ `{ ok: false }` (o route mapeia a 400).
 * PURO: sem DB/I/O.
 */
export function parseWebSearchConfig(raw: unknown): WebSearchConfigParse {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false }
  const obj = raw as { enabled?: unknown; allowlist?: unknown }
  if (typeof obj.enabled !== 'boolean') return { ok: false }
  const allowlist = parseAllowlist(obj.allowlist)
  if (allowlist === null) return { ok: false }
  return { ok: true, value: { enabled: obj.enabled, allowlist } }
}

/**
 * Um host está coberto pela allowlist se ele É um domínio listado OU um SUBDOMÍNIO dele (`*.dominio`).
 * Comparação contra os valores JÁ canônicos (minúsculos, sem `www.`). Ex.: allowlist `['tudogostoso.com.br']`
 * cobre `tudogostoso.com.br` e `m.tudogostoso.com.br`, mas NÃO `evil-tudogostoso.com.br` (boundary de
 * rótulo via o ponto). PURO.
 */
function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  const bare = h.startsWith('www.') ? h.slice(4) : h
  for (const domain of allowlist) {
    if (bare === domain || bare.endsWith('.' + domain)) return true
  }
  return false
}

/**
 * GUARD de SSRF + allowlist (fonte ÚNICA, ADR-0019): uma URL é importável/buscável SÓ se for http(s)
 * bem-formada E seu host estiver na allowlist. Allowlist vazia ⇒ NADA passa (fail-closed). Recusa
 * file:/ftp:/javascript:/data: e qualquer host fora da curadoria. NÃO toca a rede (a resolução de IP /
 * defesa contra rebind fica no fetch real; aqui é a barreira de domínio declarativa). PURO.
 */
export function isUrlAllowed(url: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.hostname === '') return false
  return hostMatchesAllowlist(u.hostname, allowlist)
}
