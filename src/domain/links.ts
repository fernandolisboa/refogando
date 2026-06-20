/**
 * Links sociais do perfil (#127, frente Perfil; PRD #122 histórias 9/10). Lógica PURA (sem DB,
 * sem rede): valida uma lista de links `{ tipo, url }` antes de gravar em `users.links`. A
 * unicidade/persistência vive na borda (PATCH /api/me); aqui só a FORMA e a SEGURANÇA.
 *
 * Mesma tese de `handle.ts`/`access.ts`: kernel puro + testável em unidade, separado do I/O.
 *
 * SEGURANÇA (crítico): esses links são renderizados CLICÁVEIS no perfil público (#129). Uma URL
 * de esquema perigoso (`javascript:`, `data:`, `vbscript:`, `file:`…) ou protocol-relative (`//`)
 * vira XSS armazenado / phishing. Por isso só http(s) explícito passa — qualquer outra coisa é
 * recusada. O esquema é normalizado (lowercase) ANTES da checagem (`JavaScript:` ≠ seguro).
 */

/** Tipos de link conhecidos. Allowlist fechada — fonte única consumida pela UI e pela borda. */
export const LINK_TIPOS = ['instagram', 'x', 'github', 'youtube', 'site'] as const
export type LinkTipo = (typeof LINK_TIPOS)[number]

/** Quantidade máxima de links por perfil. Acima disso a lista inteira é recusada. */
export const LINKS_MAX = 5

/**
 * Cap de tamanho da URL. 2048 é o teto prático de URL na maioria dos navegadores/servidores;
 * acima disso é quase sempre lixo/abuso. Medido APÓS o trim (o que conta é o conteúdo gravado).
 */
export const LINK_URL_MAX_LEN = 2048

/** Um link do perfil: um tipo conhecido + uma URL http(s) válida. */
export type ProfileLink = { tipo: LinkTipo; url: string }

/** Veredito da validação da lista de links. `ok:false` carrega o motivo (auditável/i18n). */
export type LinksValidation =
  | { ok: true; links: ProfileLink[] }
  | {
      ok: false
      reason: 'not_array' | 'too_many' | 'bad_entry' | 'unknown_tipo' | 'bad_url'
    }

/** Conjunto fechado dos tipos, para checagem O(1). */
const TIPOS = new Set<string>(LINK_TIPOS)

function isLinkTipo(v: unknown): v is LinkTipo {
  return typeof v === 'string' && TIPOS.has(v)
}

/**
 * Valida uma URL como http(s) SEGURA e bem-formada. Retorna a URL normalizada (trimada; o
 * `URL` canoniza o host) ou `null` se inválida/insegura. Decisões:
 *  - trim primeiro (whitespace de borda não é conteúdo);
 *  - vazia → inválida;
 *  - cap de tamanho ANTES de parsear (uma URL gigante é abuso, não precisa parsear);
 *  - `new URL()` exige esquema absoluto: protocol-relative `//host` e caminhos relativos
 *    NÃO parseiam → recusados de graça (o que evita o vetor `//evil.com`);
 *  - o `protocol` do `URL` já vem com `:` e LOWERCASE (o WHATWG normaliza) → comparamos contra
 *    `http:`/`https:`. Logo `JavaScript:` / `DATA:` caem fora. Só esses dois esquemas passam.
 */
export function safeHttpUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const url = input.trim()
  if (url.length === 0 || url.length > LINK_URL_MAX_LEN) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // `URL.protocol` já é minúsculo e termina em ':' (normalização WHATWG). Allowlist estrita.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // Exige um host (`http:///path` ou `https://` sem host são lixo / não-clicáveis).
  if (parsed.hostname.length === 0) return null
  return url
}

/**
 * Valida a lista completa de links do perfil. Devolve a lista NORMALIZADA (tipos verbatim,
 * URLs trimadas) em caso de sucesso — é o que a borda grava. Regras, em ordem:
 *  - precisa ser array (`not_array`);
 *  - no máximo LINKS_MAX entradas (`too_many`);
 *  - cada entrada é um objeto com `tipo` e `url` (`bad_entry`);
 *  - `tipo` na allowlist (`unknown_tipo`);
 *  - `url` http(s) segura e dentro do cap (`bad_url`).
 * Lista vazia é VÁLIDA (o usuário pode remover todos os links).
 */
export function validateLinks(input: unknown): LinksValidation {
  if (!Array.isArray(input)) return { ok: false, reason: 'not_array' }
  if (input.length > LINKS_MAX) return { ok: false, reason: 'too_many' }

  const links: ProfileLink[] = []
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, reason: 'bad_entry' }
    }
    const { tipo, url } = entry as { tipo?: unknown; url?: unknown }
    if (!isLinkTipo(tipo)) {
      // tipo ausente/não-string → bad_entry; string mas fora da allowlist → unknown_tipo.
      return { ok: false, reason: typeof tipo === 'string' ? 'unknown_tipo' : 'bad_entry' }
    }
    if (typeof url !== 'string') return { ok: false, reason: 'bad_entry' }
    const safe = safeHttpUrl(url)
    if (safe === null) return { ok: false, reason: 'bad_url' }
    links.push({ tipo, url: safe })
  }
  return { ok: true, links }
}
