import { DEFAULT_LOCALE } from '@/i18n/locale'

/**
 * Helpers compartilhados de parsing de parâmetros de rota (DRY entre os route
 * handlers dinâmicos). Sem DB, sem auth — só leitura de `id`/`?locale` do Request.
 *
 * `UUID_RE`/`isUuid` vêm do domínio (`@/domain/uuid`, fonte única — reusados pela busca de
 * usuários #269); re-exportados aqui pra não quebrar os imports dos handlers existentes. Um `id`
 * malformado cairia na coluna uuid e faria o Postgres lançar 22P02 (500 / vazamento de SQL); os
 * handlers curto-circuitam para o MESMO not_found — malformado é indistinguível de ausente.
 */
export { UUID_RE, isUuid } from '@/domain/uuid'

/**
 * Lê `?locale` do Request e cai no DEFAULT_LOCALE canônico (tipado, '@/i18n/locale')
 * quando ausente. NÃO valida contra SUPPORTED_LOCALES — a resolução final
 * (fallback de locale não suportado) é responsabilidade do módulo de leitura.
 */
export function parseRequestLocale(request: Request): string {
  return new URL(request.url).searchParams.get('locale') ?? DEFAULT_LOCALE
}
