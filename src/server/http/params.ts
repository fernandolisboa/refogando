import { DEFAULT_LOCALE } from '@/i18n/locale'

/**
 * Helpers compartilhados de parsing de parâmetros de rota (DRY entre os route
 * handlers dinâmicos). Sem DB, sem auth — só leitura de `id`/`?locale` do Request.
 *
 * `UUID_RE`: um `id` malformado cairia na coluna uuid e faria o Postgres lançar
 * 22P02 (500 / vazamento de SQL). Os handlers curto-circuitam para o MESMO
 * not_found — malformado é indistinguível de ausente na superfície da API.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `true` se `id` tem a forma de um uuid (não toca no DB). */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * Lê `?locale` do Request e cai no DEFAULT_LOCALE canônico (tipado, '@/i18n/locale')
 * quando ausente. NÃO valida contra SUPPORTED_LOCALES — a resolução final
 * (fallback de locale não suportado) é responsabilidade do módulo de leitura.
 */
export function parseRequestLocale(request: Request): string {
  return new URL(request.url).searchParams.get('locale') ?? DEFAULT_LOCALE
}
