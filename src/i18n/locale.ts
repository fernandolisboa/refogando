/**
 * Núcleo puro de locale (issue #4, ADR-0014). Sem React, sem DB, sem next/headers —
 * só lógica de resolução testável em unit (T2). `SUPPORTED_LOCALES` é a fonte única
 * dos locales que a chrome sabe renderizar.
 */
export const SUPPORTED_LOCALES = ['pt-BR', 'en-US'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'pt-BR' // D10

// Mapa lowercase → forma canônica (pt-br → pt-BR). Locales BCP-47 são
// case-insensitive (RFC 5646 §2.1.1), então normalizamos antes de casar:
// 'EN-US'/'pt-br' do navegador devem resolver para 'en-US'/'pt-BR'.
const CANONICAL_BY_LOWER: Record<string, Locale> = Object.fromEntries(
  SUPPORTED_LOCALES.map((l) => [l.toLowerCase(), l]),
)

/**
 * Devolve a forma canônica de um locale suportado, casando case-insensitive
 * (ex.: 'EN-US' → 'en-US', 'pt-br' → 'pt-BR'). `null` se não suportado.
 *
 * EXPORTADA (issue #23): as rotas de tradução validam E canonizam o locale do path com
 * ela — `isSupportedLocale` é case-insensitive, então persistir/ler o path cru partiria
 * a chave UNIQUE(recipe_id, locale). Sempre o canônico (`'EN-US'` → `'en-US'`).
 */
export function canonicalLocale(v: string): Locale | null {
  return CANONICAL_BY_LOWER[v.toLowerCase()] ?? null
}

export function isSupportedLocale(v: string): v is Locale {
  return canonicalLocale(v) !== null
}

/**
 * Tag BCP-47 → locale suportado: casa exato (case-insensitive) e, senão, pelo idioma-base
 * ('pt' → 'pt-BR', 'en-GB'/'en_GB' → 'en-US' — só há um locale por idioma). `null` se o idioma
 * não é suportado. Fonte única do casamento por idioma (Accept-Language e saída da geração).
 */
export function localeFromTag(tag: string): Locale | null {
  const t = tag.trim()
  const canon = canonicalLocale(t)
  if (canon) return canon
  const base = t.split(/[-_]/)[0].toLowerCase()
  if (base === '') return null
  return SUPPORTED_LOCALES.find((l) => l.split('-')[0].toLowerCase() === base) ?? null
}

/**
 * Resolve o locale a usar a partir de uma preferência explícita OU do header
 * Accept-Language do navegador. Locale não suportado → DEFAULT_LOCALE (D10, #4.AC3):
 * nunca tela quebrada. `preferred` (ex.: cookie do Visitante ou users.locale do logado)
 * tem prioridade sobre a detecção.
 */
export function resolveLocale(input: {
  preferred?: string | null
  acceptLanguage?: string | null
}): Locale {
  if (input.preferred) {
    const canon = canonicalLocale(input.preferred)
    if (canon) return canon // case-insensitive: 'EN-US'/'pt-br' → forma canônica
  }
  for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
    const match = localeFromTag(tag)
    if (match) return match // ex.: 'pt' → 'pt-BR', 'EN' → 'en-US'
  }
  return DEFAULT_LOCALE
}

/**
 * Parser puro de Accept-Language em tags ordenadas por q (decrescente).
 * Ignora o wildcard '*'. q ausente → 1 (default BCP-47); q malformado
 * (';q=abc' → NaN) vira 0, então NUNCA vence um q válido — tags inválidas
 * caem para o fim em vez de flutuarem com NaN no sort.
 */
function parseAcceptLanguage(header?: string | null): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=')
      const n = q ? Number(q) : 1
      return { tag: tag.trim(), q: Number.isFinite(n) ? n : 0 }
    })
    .filter((x) => x.tag && x.tag !== '*')
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag)
}
