/**
 * Núcleo PURO de roteamento por locale-no-caminho (issue #228, ADR-0020). Sem `next/*`,
 * sem DB: só a decisão "dado um pathname + headers, qual redirect (se algum)?". O `proxy.ts`
 * é um wrapper fino sobre isto; assim a política inteira de prefixação fica verificável no
 * projeto de teste "ui" (jsdom, sem banco), e o proxy só traduz a decisão pra `NextResponse`.
 *
 * Princípios inegociáveis (ADR-0020) honrados aqui:
 *  - prefix-all: TODO caminho carrega `/pt-BR` ou `/en-US`; a raiz nua `/` só detecta e manda.
 *  - o redirect é SEMPRE temporário (302) — NUNCA 301. 301 é cacheável e colaria o usuário no
 *    1º idioma resolvido (e esconderia o 2º destino do Google). Vale pra raiz E pra
 *    normalização de case do prefixo (`/pt-br/...` → `/pt-BR/...`).
 *  - os segmentos de rota seguem em inglês SOB o prefixo (`/recipes`, nunca `/receitas`) — este
 *    módulo nunca traduz a rota, só prefixa.
 */
import {
  SUPPORTED_LOCALES,
  canonicalLocale,
  resolveLocale,
  type Locale,
} from '@/i18n/locale'

/** O redirect do locale é SEMPRE temporário. Constante nomeada pra deixar o "nunca 301" explícito. */
export const LOCALE_REDIRECT_STATUS = 302 as const

export type LocaleRedirect = { to: string; status: typeof LOCALE_REDIRECT_STATUS }

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
 *  - `/{locale-mau-case}/...`  → 302 normalizando SÓ o case do prefixo (mantém o idioma do path,
 *    não o detectado: a intenção do usuário foi explícita na URL).
 *  - caminho não-prefixado (inclui a raiz `/`) → 302 prefixando com o locale DETECTADO
 *    (cookie → Accept-Language → DEFAULT_LOCALE), preservando a rota.
 */
export function decideLocaleRedirect(input: {
  pathname: string
  cookieLocale?: string | null
  acceptLanguage?: string | null
}): LocaleRedirect | null {
  const split = splitLocalePrefix(input.pathname)

  if (split.locale) {
    // Já prefixado. Canônico → segue; mau-case → normaliza SEM trocar de idioma.
    if (split.canonical) return null
    return {
      to: localePrefixedPath(split.locale, split.rest),
      status: LOCALE_REDIRECT_STATUS,
    }
  }

  // Não-prefixado (inclui a raiz): detecta e prefixa, preservando a rota original.
  const detected = resolveLocale({
    preferred: input.cookieLocale,
    acceptLanguage: input.acceptLanguage,
  })
  return {
    to: localePrefixedPath(detected, split.rest),
    status: LOCALE_REDIRECT_STATUS,
  }
}

/** Re-export por conveniência pro proxy e pra validação de params. */
export { SUPPORTED_LOCALES, type Locale }
