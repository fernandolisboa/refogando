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

/** Teto do IP usado como chave de throttle (IPv6 completo ≤ 45 chars); barra uma chave gigante forjada. */
const CLIENT_IP_MAX = 64

/**
 * Deriva o IP do cliente dos headers de proxy (atrás do Vercel/CDN, `request.ip` não existe no runtime
 * Node das rotas). Ordem: 1º hop do `x-forwarded-for` (cadeia "cliente, proxy1, …") → `x-real-ip`. Só
 * leitura de header (sem DB, sem auth), usado como CHAVE de rate-limit best-effort — nunca vai ao banco,
 * então capamos só o comprimento (anti-chave-abusiva). `null` quando nenhum header traz IP (local/teste):
 * o caller decide o fail-open. É metadado de rede confiável só na medida em que o proxy da frente é.
 */
export function clientIpFromHeaders(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, CLIENT_IP_MAX)
  }
  const real = request.headers.get('x-real-ip')?.trim()
  return real ? real.slice(0, CLIENT_IP_MAX) : null
}
