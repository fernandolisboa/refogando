import type { NextConfig } from 'next'
import { e2eFakesActive } from './src/server/e2e/mode'

/**
 * TRIPWIRE do modo fake do E2E (#589). Avaliado em TODO `next build`/`next start`: sem a flag
 * `REFOGANDO_E2E_FAKES` é no-op; com ela fora do ambiente do harness (marcador da Vercel, banco ou URLs
 * fora de loopback) LANÇA e derruba o build — um deploy nunca sai com os provedores trocados por dublês.
 * O mesmo guarda roda de novo em runtime (deps.ts e instrumentation.ts).
 */
e2eFakesActive()

/**
 * `images.remotePatterns` libera o host do Vercel Blob (#126) — onde moram os avatares e, depois,
 * as Imagens da receita (entidade `recipe_image`, #130). O store é PUBLIC, então a URL serve a
 * imagem direto; o repo renderiza com `<img>` simples (convenção), mas `remotePatterns` mantém a
 * porta aberta pra `next/image` sem retrabalho. O subdomínio do store varia (`<id>.public...`),
 * por isso o wildcard de host.
 */

/**
 * Content-Security-Policy (#444). Entra em **Report-Only** de propósito: sem `report-uri`, ela só
 * emite violações no console do navegador — observamos por alguns dias e SÓ ENTÃO promovemos a
 * enforce (issue de follow-up), sem risco de quebrar a UI. `img-src` precisa do wildcard do Blob
 * (avatares/imagens da receita) E de `lh3.googleusercontent.com` (avatar vindo do Google OAuth,
 * gravado em `users.image`). `script-src`/`style-src` com `'unsafe-inline'` é o compromisso
 * pragmático do App Router sem nonce — endurecer para nonce exigiria middleware (deferido).
 * Atenção (handoff 67): uma CSP com nonce força render dinâmico em TODA rota (o nonce é por request, então
 * as páginas ISR deixariam de ser estáticas) e, com um nonce presente, o navegador IGNORA o
 * `'unsafe-inline'`: o script pré-pintura do tema (`THEME_INIT_SCRIPT`, inline e sem nonce, no `<head>` do
 * root layout) seria bloqueado. Quem for por esse caminho precisa dar o nonce a esse script (ou um hash).
 */
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/**
 * Headers de segurança (#444). Antes disto o app não emitia NENHUM — sem CSP, X-Frame-Options,
 * nosniff, Referrer-Policy nem Permissions-Policy, e ainda vazava `x-powered-by`. Estes são
 * defesa-em-profundidade: os `dangerouslySetInnerHTML` do repo são o JSON-LD, já escapado por
 * `serializeJsonLd`, e o script do tema, texto fixo gerado no servidor (`src/lib/theme-script.ts`), mas
 * estes headers blindam contra clickjacking, MIME-sniffing e um XSS futuro.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Content-Security-Policy-Report-Only', value: CSP_REPORT_ONLY },
]

const nextConfig: NextConfig = {
  // Não vaza a stack usada (default do Next emite `x-powered-by: Next.js`).
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.public.blob.vercel-storage.com',
      },
    ],
  },
}

export default nextConfig
