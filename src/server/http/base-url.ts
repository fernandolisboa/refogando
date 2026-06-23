import { headers } from 'next/headers'

/**
 * Base URL absoluta DERIVADA SÓ DE ENV (sem `headers()`) — BUILD-SAFE (#232/#235, ADR-0020).
 *
 * É a base que o `generateMetadata`/`metadataBase`/canonical/hreflang/OG do detalhe PÚBLICO usam:
 * tocar `headers()` ali FORÇA a página a dinâmica e mata a cacheabilidade do caminho indexável.
 * Por isso esta variante NÃO lê header algum — só env, e cai num default seguro de dev.
 *
 * Ordem: `APP_URL` (server-only) → em PRODUÇÃO na Vercel o domínio PÚBLICO de produção
 * `VERCEL_PROJECT_PRODUCTION_URL` (o `VERCEL_URL` do deploy é *.vercel.app, atrás do Vercel
 * Authentication) → `VERCEL_URL`. Em produção sem nenhum desses ⇒ lança (não há fallback de header
 * aqui — quem quiser o host de request usa `getBaseUrl`). Em dev ⇒ `http://localhost:3000`.
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

/**
 * Base URL absoluta p/ fetch server-side da própria API (issue #57). Um Server
 * Component que faz `fetch` da rota NÃO aceita URL relativa — precisa do host.
 *
 * Ordem: `APP_URL`/`VERCEL_*` via `getBaseUrlFromEnv` → derivar de `headers()` (host +
 * `x-forwarded-proto`, cobre dev local sem env). DINÂMICA (lê `headers()` no fallback): usar SÓ no
 * caminho do DONO (já dinâmico). Pro caminho PÚBLICO/indexável (metadataBase/canonical/OG) use a
 * variante build-safe `getBaseUrlFromEnv`, que NÃO toca `headers()`.
 *
 * O fallback por `Host`/`x-forwarded-proto` é APENAS para dev local: ambos são headers
 * controláveis pelo cliente e o retorno vira alvo de um `fetch` server-side, então um
 * Host forjado poderia redirecionar a requisição interna (SSRF/cache-poisoning). Em
 * produção exigimos `APP_URL` ou `VERCEL_URL` (na Vercel `VERCEL_URL` está sempre setado)
 * — sem trustar o Host de entrada.
 *
 * Importa `next/headers` ⇒ server-only; não importável de client.
 */
export async function getBaseUrl(): Promise<string> {
  // Em produção/preview a base vem de env (build-safe, mesma fonte do caminho público). Em dev
  // SEM env, caímos no header Host (cobre dev local) — caminho do dono, que já é dinâmico.
  if (
    process.env.APP_URL ||
    (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    process.env.VERCEL_URL ||
    process.env.NODE_ENV === 'production'
  ) {
    return getBaseUrlFromEnv()
  }
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
