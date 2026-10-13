/**
 * Base URL absoluta DERIVADA SÓ DE ENV (sem `headers()`) — BUILD-SAFE (#232/#235, ADR-0020).
 *
 * É a base que o `generateMetadata`/`metadataBase`/canonical/hreflang/OG do detalhe PÚBLICO usam:
 * tocar `headers()` ali FORÇA a página a dinâmica e mata a cacheabilidade do caminho indexável.
 * Por isso esta variante NÃO lê header algum — só env, e cai num default seguro de dev.
 *
 * Ordem: `APP_URL` (server-only) → em PRODUÇÃO na Vercel o domínio PÚBLICO de produção
 * `VERCEL_PROJECT_PRODUCTION_URL` (o `VERCEL_URL` do deploy é *.vercel.app, atrás do Vercel
 * Authentication) → `VERCEL_URL`. Em produção sem nenhum desses ⇒ lança (não há fallback de header:
 * Host/x-forwarded-proto são controláveis pelo cliente). Em dev ⇒ `http://localhost:3000`.
 *
 * `APP_URL` NÃO leva o prefixo `NEXT_PUBLIC_` de propósito (consumo server-only; o repo não tem
 * nenhuma `NEXT_PUBLIC_*`, mesmo estilo de `BETTER_AUTH_URL`). PURA (sem I/O assíncrono) ⇒ síncrona.
 */
export function getBaseUrlFromEnv(): string {
  if (process.env.APP_URL) return process.env.APP_URL
  // Em PRODUÇÃO na Vercel, o domínio PÚBLICO de produção não é murado pelo Vercel Authentication
  // (o `VERCEL_URL` *.vercel.app está). SÓ em produção: num preview aquele var aponta pra PROD.
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getBaseUrlFromEnv: defina APP_URL (ou VERCEL_URL) em produção — não há fallback por header aqui (build-safe).',
    )
  }
  // Dev: default estável SEM tocar `headers()` (mantém o caminho público cacheável).
  return 'http://localhost:3000'
}
