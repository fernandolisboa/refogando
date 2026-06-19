import { headers } from 'next/headers'

/**
 * Base URL absoluta p/ fetch server-side da própria API (issue #57). Um Server
 * Component que faz `fetch` da rota NÃO aceita URL relativa — precisa do host.
 *
 * Ordem: `APP_URL` (server-only) → em PRODUÇÃO na Vercel o domínio PÚBLICO de produção
 * `VERCEL_PROJECT_PRODUCTION_URL` (o `VERCEL_URL` do deploy é *.vercel.app, atrás do Vercel
 * Authentication) → `VERCEL_URL` → derivar de `headers()` (host + `x-forwarded-proto`, cobre
 * dev local sem env). `APP_URL` NÃO leva
 * o prefixo `NEXT_PUBLIC_` de propósito: o consumo é server-only e o repo não tem
 * nenhuma `NEXT_PUBLIC_*` (mesmo estilo de `BETTER_AUTH_URL`).
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
  if (process.env.APP_URL) return process.env.APP_URL
  // Em PRODUÇÃO na Vercel, a URL do DEPLOY (`VERCEL_URL`, *.vercel.app) está atrás do Vercel
  // Authentication (`ssoProtection: all_except_custom_domains`): um self-fetch server-side bate
  // no MURO (401), não na rota — o detalhe da Receita (que faz self-fetch) quebrava com "Algo
  // deu errado". O domínio PÚBLICO de produção (`VERCEL_PROJECT_PRODUCTION_URL`, ex.:
  // www.refogando.com) não é murado. SÓ em produção: num preview esse var aponta pra PROD
  // (o self-fetch leria dados de produção), então o preview segue no próprio `VERCEL_URL`.
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getBaseUrl: defina APP_URL (ou VERCEL_URL) em produção — o fallback por header Host só vale em dev.',
    )
  }
  const h = await headers()
  const host = h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}
