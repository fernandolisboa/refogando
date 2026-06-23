/**
 * `robots.txt` (#235, ADR-0020) — gerado pelo Metadata File do Next (`app/robots.ts`).
 *
 * Política: LIBERA o índice (`allow: '/'`) e aponta o sitemap absoluto. O gate `noindex` é POR
 * PÁGINA (`buildRecipeMetadata` emite `robots: noindex` no caminho do dono/não-elegível, #233) — o
 * robots.txt NÃO replica esse gate por-receita; ele só não pode BLOQUEAR o que é indexável. Por isso
 * NÃO desautorizamos `/{locale}/recipes/*` aqui — o sitemap lista só o indexável e cada página
 * não-elegível se auto-protege com `noindex`.
 *
 * Bloqueamos as superfícies NÃO-públicas óbvias: a API (`/api/`, JSON server-only) e o painel admin
 * (`/admin`, restrito ao Curador/Admin — espelha `/{locale}/admin/*`; o crawler não tem o que indexar
 * ali e nem deve tentar). `disallow` é prefixo de caminho (sem locale por design — cobre qualquer
 * prefixo de locale via o segmento, e os caminhos sem locale também).
 *
 * `sitemap` é URL ABSOLUTA via `getBaseUrlFromEnv` (env-only, sem `headers()`) — BUILD-SAFE: este
 * arquivo de metadados pode ser avaliado em build/estaticamente, então NUNCA derivamos o host do
 * request. Função SÍNCRONA (sem I/O) — espelha a casca fina dos demais Metadata Files.
 */
import type { MetadataRoute } from 'next'
import { getBaseUrlFromEnv } from '@/server/http/base-url'

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrlFromEnv()
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Superfícies não-públicas: API JSON e painel admin (qualquer prefixo de locale).
        disallow: ['/api/', '/admin'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
