/**
 * Núcleo PURO de roteamento por locale-no-caminho (issue #228, ADR-0020). Sem `next/*`,
 * sem DB: só a decisão "dado um pathname + headers, qual redirect (se algum)?". O `proxy.ts`
 * é um wrapper fino sobre isto; assim a política inteira de prefixação fica verificável no
 * projeto de teste "ui" (jsdom, sem banco), e o proxy só traduz a decisão pra `NextResponse`.
 *
 * Princípios inegociáveis (ADR-0020) honrados aqui — DOIS redirects, com status DIFERENTES de
 * propósito (decisão 1):
 *  - prefix-all: TODO caminho carrega `/pt-BR` ou `/en-US`; a raiz nua `/` só detecta e manda.
 *  - DETECÇÃO/raiz (caminho não-prefixado → locale detectado): **302** (temporário) — NUNCA 301.
 *    O destino VARIA por `Accept-Language`; um 301 cacheável colaria o usuário no 1º idioma
 *    resolvido (e esconderia o 2º destino do Google). Leva `Vary: Accept-Language`.
 *  - NORMALIZAÇÃO DE CASE (`/pt-br/...` → `/pt-BR/...`): **301** (permanente). Aqui o idioma vem
 *    do PATH, não da detecção — o destino NÃO depende do `Accept-Language`; é canonicalização
 *    pura ("não abrir URL duplicada", decisão 1). Um 301 consolida o link equity da variante
 *    lowercase na URL canônica, que é justamente o que o ADR quer (SEO).
 *  - os segmentos de rota seguem em inglês SOB o prefixo (`/recipes`, nunca `/receitas`) — este
 *    módulo nunca traduz a rota, só prefixa.
 */
import {
  SUPPORTED_LOCALES,
  canonicalLocale,
  resolveLocale,
  type Locale,
} from '@/i18n/locale'

/**
 * Redirect de DETECÇÃO (raiz/caminho não-prefixado → locale detectado): SEMPRE temporário (302),
 * NUNCA 301. O destino depende do `Accept-Language`, então não pode ser cacheado como permanente.
 */
export const LOCALE_DETECT_REDIRECT_STATUS = 302 as const
/**
 * Redirect de NORMALIZAÇÃO DE CASE (`/pt-br/...` → `/pt-BR/...`): permanente (301). O idioma já
 * está no path (não vem de detecção), então é canonicalização Accept-Language-independente —
 * 301 consolida a variante lowercase na canônica (ADR-0020 decisão 1).
 */
export const LOCALE_CASE_REDIRECT_STATUS = 301 as const

export type LocaleRedirectStatus =
  | typeof LOCALE_DETECT_REDIRECT_STATUS
  | typeof LOCALE_CASE_REDIRECT_STATUS

export type LocaleRedirect = { to: string; status: LocaleRedirectStatus }

export type LocalePrefixSplit = {
  /** Forma canônica do locale do 1º segmento, ou `null` se o 1º segmento não é um locale suportado. */
  locale: Locale | null
  /** `true` só quando o segmento JÁ está na forma canônica exata (ex.: `pt-BR`, não `pt-br`). */
  canonical: boolean
  /** O caminho depois do prefixo de locale, começando com `/` (raiz nua → `/`). */
  rest: string
}

/**
 * Separa o 1º segmento do pathname e tenta lê-lo como locale. Case-insensitive (RFC 5646):
 * `/PT-br/...` casa `pt-BR`, mas `canonical:false` sinaliza que precisa normalizar. O `rest`
 * sempre começa com `/` e a raiz nua do locale (`/pt-BR`) devolve `rest:'/'`.
 */
export function splitLocalePrefix(pathname: string): LocalePrefixSplit {
  // pathname sempre começa com '/'; o 1º segmento é o trecho entre a 1ª e a 2ª barra.
  const withoutLeading = pathname.replace(/^\/+/, '')
  const slash = withoutLeading.indexOf('/')
  const firstSegment = slash === -1 ? withoutLeading : withoutLeading.slice(0, slash)
  const afterFirst = slash === -1 ? '' : withoutLeading.slice(slash) // já começa com '/'

  const canon = firstSegment ? canonicalLocale(firstSegment) : null
  if (!canon) {
    return { locale: null, canonical: false, rest: pathname || '/' }
  }
  const rest = afterFirst === '' ? '/' : afterFirst
  return { locale: canon, canonical: firstSegment === canon, rest }
}

/**
 * Monta `/{locale}{rest}` sem barra final pendurada na raiz: `('pt-BR','/')` → `/pt-BR`.
 * `rest` pode vir como `''` ou `'/'` pra raiz daquele locale.
 */
export function localePrefixedPath(locale: Locale, rest: string): string {
  if (rest === '' || rest === '/') return `/${locale}`
  const withSlash = rest.startsWith('/') ? rest : `/${rest}`
  return `/${locale}${withSlash}`
}

/**
 * Decisão central: dado o pathname + a preferência (cookie) + o Accept-Language, devolve o
 * redirect a aplicar — ou `null` quando o caminho JÁ está corretamente prefixado (sem loop).
 *
 *  - `/{locale-canônico}/...`  → `null` (deixa passar).
 *  - `/{locale-mau-case}/...`  → **301** normalizando SÓ o case do prefixo (mantém o idioma do
 *    path, não o detectado: a intenção do usuário foi explícita na URL; canonicalização
 *    permanente, Accept-Language-independente).
 *  - caminho não-prefixado (inclui a raiz `/`) → **302** prefixando com o locale DETECTADO
 *    (cookie → Accept-Language → DEFAULT_LOCALE), preservando a rota.
 */
export function decideLocaleRedirect(input: {
  pathname: string
  cookieLocale?: string | null
  acceptLanguage?: string | null
}): LocaleRedirect | null {
  const split = splitLocalePrefix(input.pathname)

  if (split.locale) {
    // Já prefixado. Canônico → segue; mau-case → normaliza SEM trocar de idioma (301 permanente:
    // o idioma vem do path, não da detecção, então é canonicalização Accept-Language-independente).
    if (split.canonical) return null
    return {
      to: localePrefixedPath(split.locale, split.rest),
      status: LOCALE_CASE_REDIRECT_STATUS,
    }
  }

  // Não-prefixado (inclui a raiz): detecta e prefixa, preservando a rota original (302 temporário:
  // o destino depende do Accept-Language, nunca cacheável como permanente).
  const detected = resolveLocale({
    preferred: input.cookieLocale,
    acceptLanguage: input.acceptLanguage,
  })
  return {
    to: localePrefixedPath(detected, split.rest),
    status: LOCALE_DETECT_REDIRECT_STATUS,
  }
}

/** Re-export por conveniência pro proxy e pra validação de params. */
export { SUPPORTED_LOCALES, type Locale }
